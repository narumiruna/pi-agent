import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  ResourceDiagnostic,
  Skill,
} from "@earendil-works/pi-coding-agent";
import type {
  WebSkillDiagnostic,
  WebSkillFileDocument,
  WebSkillFileEntry,
  WebSkillInventory,
  WebSkillResource,
  WebSkillWriteScope,
} from "../../shared/contracts.js";
import {
  opaqueSkillId,
  projectResourceProvenance,
  safeMetadataText,
  safePackageName,
  safePromptMetadataText,
  safePromptSourceLabel,
} from "../api-metadata.js";

export const MAX_SKILL_FILES = 500;
export const MAX_SKILL_FILE_BYTES = 500_000;
export const MAX_SKILL_PATH_LENGTH = 1_024;
const MAX_SKILL_DEPTH = 12;
const MAX_SKILL_DIAGNOSTICS = 100;
const CLASSIFICATION_BYTES = 8_192;
const NO_FOLLOW =
  (constants as unknown as Record<string, number | undefined>).O_NOFOLLOW ?? 0;

export interface NativeSkillSnapshot {
  skills: ReadonlyArray<Skill>;
  diagnostics: ReadonlyArray<ResourceDiagnostic>;
}

interface SkillRoot {
  path: string;
  entryPath: string;
}

interface SkillFiles {
  files: WebSkillFileEntry[];
  truncated: boolean;
}

function toPosix(filePath: string): string {
  return filePath.split(sep).join("/");
}

function isWithin(filePath: string, root: string): boolean {
  const path = relative(root, filePath);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

function logicalRelative(filePath: string, root: string): string {
  return toPosix(relative(root, filePath));
}

export function parseSkillFilePath(rawPath: string): string {
  if (
    rawPath.length < 1 ||
    rawPath.length > MAX_SKILL_PATH_LENGTH ||
    rawPath.includes("\0") ||
    rawPath.includes("\\") ||
    rawPath.startsWith("/") ||
    /^[a-zA-Z]:\//u.test(rawPath)
  )
    throw new Error("Skill file path is invalid");
  const segments = rawPath.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        Buffer.byteLength(segment) > 255 ||
        [...segment].some((character) => {
          const code = character.codePointAt(0) ?? 0;
          return code < 32 || code === 127;
        }),
    )
  )
    throw new Error("Skill file path is invalid");
  return segments.join("/");
}

function sameFile(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.ctimeMs === right.ctimeMs &&
    left.size === right.size &&
    left.nlink === right.nlink
  );
}

function decodeUtf8(content: Buffer): string | undefined {
  if (content.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      content,
    );
  } catch {
    return undefined;
  }
}

async function readBytes(
  handle: Awaited<ReturnType<typeof open>>,
  length: number,
): Promise<Buffer> {
  const content = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(
      content,
      offset,
      length - offset,
      offset,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return content.subarray(0, offset);
}

async function resolveSkillRoot(skill: Skill): Promise<SkillRoot | undefined> {
  const lexicalRoot = resolve(skill.baseDir);
  const lexicalEntry = resolve(skill.filePath);
  if (!isWithin(lexicalEntry, lexicalRoot)) return undefined;
  const entryPath = logicalRelative(lexicalEntry, lexicalRoot);
  try {
    parseSkillFilePath(entryPath);
    const path = await realpath(lexicalRoot);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return undefined;
    return { path, entryPath };
  } catch {
    return undefined;
  }
}

async function resolveFileTarget(root: string, relativePath: string) {
  const parsed = parseSkillFilePath(relativePath);
  const segments = parsed.split("/");
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    const candidate = join(parent, segment);
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("Skill file is unavailable");
    parent = candidate;
  }
  const path = join(parent, segments.at(-1) ?? "");
  if (!isWithin(path, root)) throw new Error("Skill file path is invalid");
  return { parent, path };
}

function unavailableEntry(
  path: string,
  size: number,
  entry: boolean,
): WebSkillFileEntry {
  return { path, size, kind: "unavailable", entry };
}

async function inspectFile(
  root: string,
  relativePath: string,
  entry: boolean,
): Promise<WebSkillFileEntry> {
  const target = await resolveFileTarget(root, relativePath);
  const before = await lstat(target.path);
  const size = Math.max(0, before.size);
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1)
    return unavailableEntry(relativePath, size, entry);
  if (size > MAX_SKILL_FILE_BYTES)
    return { path: relativePath, size, kind: "too_large", entry };
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(target.path, constants.O_RDONLY | NO_FOLLOW);
    const opened = await handle.stat();
    const afterOpen = await lstat(target.path);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      afterOpen.isSymbolicLink() ||
      !sameFile(before, opened) ||
      !sameFile(opened, afterOpen) ||
      (await realpath(target.parent)) !== target.parent
    )
      return unavailableEntry(relativePath, size, entry);
    const sample = await readBytes(
      handle,
      Math.min(size, CLASSIFICATION_BYTES),
    );
    const afterRead = await lstat(target.path);
    if (!sameFile(opened, afterRead))
      return unavailableEntry(relativePath, size, entry);
    return {
      path: relativePath,
      size,
      kind: decodeUtf8(sample) === undefined ? "binary" : "text",
      entry,
    };
  } catch {
    return unavailableEntry(relativePath, size, entry);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function listSkillFiles(skill: Skill): Promise<SkillFiles> {
  const root = await resolveSkillRoot(skill);
  const fallbackPath = safeMetadataText(basename(skill.filePath)) || "SKILL.md";
  if (!root)
    return {
      files: [unavailableEntry(fallbackPath, 0, true)],
      truncated: false,
    };
  if (basename(skill.filePath) !== "SKILL.md") {
    return {
      files: [await inspectFile(root.path, root.entryPath, true)],
      truncated: false,
    };
  }

  const files: WebSkillFileEntry[] = [];
  let visited = 0;
  let truncated = false;
  const walk = async (directory: string, prefix: string, depth: number) => {
    if (truncated) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      () => undefined,
    );
    if (!entries) return;
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (visited >= MAX_SKILL_FILES) {
        truncated = true;
        return;
      }
      visited += 1;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      try {
        parseSkillFilePath(relativePath);
      } catch {
        continue;
      }
      const path = join(directory, entry.name);
      let stat: Awaited<ReturnType<typeof lstat>>;
      try {
        stat = await lstat(path);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        files.push(
          unavailableEntry(
            relativePath,
            Math.max(0, stat.size),
            relativePath === root.entryPath,
          ),
        );
      } else if (stat.isDirectory()) {
        if (depth >= MAX_SKILL_DEPTH) {
          truncated = true;
          continue;
        }
        await walk(path, relativePath, depth + 1);
      } else {
        files.push(
          await inspectFile(
            root.path,
            relativePath,
            relativePath === root.entryPath,
          ),
        );
      }
    }
  };
  await walk(root.path, "", 0);
  if (!files.some(({ entry }) => entry)) {
    if (files.length >= MAX_SKILL_FILES) files.pop();
    files.unshift(await inspectFile(root.path, root.entryPath, true));
  }
  files.sort(
    (left, right) =>
      Number(right.entry) - Number(left.entry) ||
      left.path.localeCompare(right.path),
  );
  return { files, truncated };
}

function agentsSkillPath(skill: Skill): string | undefined {
  const normalized = toPosix(resolve(skill.filePath));
  const marker = "/.agents/skills/";
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return undefined;
  const prefix = skill.sourceInfo.scope === "user" ? "~/" : "";
  return `${prefix}.agents/skills/${normalized.slice(index + marker.length)}`;
}

export function canonicalSkillScope(
  skill: Skill,
  agentDir: string,
  workspace: string,
): WebSkillWriteScope | undefined {
  if (skill.sourceInfo.origin !== "top-level") return undefined;
  if (skill.sourceInfo.scope !== "user" && skill.sourceInfo.scope !== "project")
    return undefined;
  const scope = skill.sourceInfo.scope;
  const root =
    scope === "user"
      ? join(agentDir, "skills")
      : join(workspace, ".pi", "skills");
  const canonicalRoot = resolve(root);
  const filePath = resolve(skill.filePath);
  if (!isWithin(filePath, canonicalRoot)) return undefined;
  const segments = relative(canonicalRoot, filePath).split(sep);
  if (basename(filePath) === "SKILL.md" && segments.length <= 2) return scope;
  if (segments.length === 1 && basename(filePath).endsWith(".md")) return scope;
  return undefined;
}

function logicalSkillPath(
  skill: Skill,
  agentDir: string,
  workspace: string,
): string {
  const filePath = resolve(skill.filePath);
  const userRoot = join(agentDir, "skills");
  if (isWithin(filePath, userRoot))
    return `~/.pi/agent/skills/${logicalRelative(filePath, userRoot)}`;
  const projectRoot = join(workspace, ".pi", "skills");
  if (isWithin(filePath, projectRoot))
    return `.pi/skills/${logicalRelative(filePath, projectRoot)}`;
  const agentsPath = agentsSkillPath(skill);
  if (agentsPath) return agentsPath;
  if (skill.sourceInfo.origin === "package") {
    const boundary = resolve(skill.sourceInfo.baseDir ?? skill.baseDir);
    const path = isWithin(filePath, boundary)
      ? logicalRelative(filePath, boundary)
      : basename(filePath);
    return `packages/${safePackageName(skill.sourceInfo.source)}/${path}`;
  }
  const directory = safeMetadataText(basename(skill.baseDir)) || "skill";
  const prefix =
    skill.sourceInfo.scope === "temporary" ? "temporary" : "settings";
  return `${prefix}/${directory}/${basename(filePath)}`;
}

function logicalDiagnosticPath(
  filePath: string,
  skills: ReadonlyArray<Skill>,
  agentDir: string,
  workspace: string,
): { path: string; skillId?: string } {
  const active = skills.find(
    (skill) => resolve(skill.filePath) === resolve(filePath),
  );
  if (active)
    return {
      path: safeMetadataText(logicalSkillPath(active, agentDir, workspace)),
      skillId: opaqueSkillId(active.sourceInfo),
    };
  const userRoot = join(agentDir, "skills");
  if (isWithin(filePath, userRoot))
    return {
      path: safeMetadataText(
        `~/.pi/agent/skills/${logicalRelative(filePath, userRoot)}`,
      ),
    };
  const projectRoot = join(workspace, ".pi", "skills");
  if (isWithin(filePath, projectRoot))
    return {
      path: safeMetadataText(
        `.pi/skills/${logicalRelative(filePath, projectRoot)}`,
      ),
    };
  const normalized = toPosix(resolve(filePath));
  const marker = "/.agents/skills/";
  const index = normalized.lastIndexOf(marker);
  if (index >= 0)
    return {
      path: safeMetadataText(
        `.agents/skills/${normalized.slice(index + marker.length)}`,
      ),
    };
  return { path: safeMetadataText(`external/${basename(filePath)}`) };
}

function projectSkillDiagnostics(
  snapshot: NativeSkillSnapshot,
  agentDir: string,
  workspace: string,
): WebSkillDiagnostic[] {
  return snapshot.diagnostics
    .slice(0, MAX_SKILL_DIAGNOSTICS)
    .map((diagnostic) => {
      const projected = diagnostic.path
        ? logicalDiagnosticPath(
            diagnostic.path,
            snapshot.skills,
            agentDir,
            workspace,
          )
        : undefined;
      return {
        severity: diagnostic.type === "error" ? "error" : "warning",
        message: safeMetadataText(diagnostic.message),
        ...(projected?.path ? { path: projected.path } : {}),
        ...(projected?.skillId ? { skillId: projected.skillId } : {}),
      };
    });
}

export class SkillViewer {
  constructor(
    private readonly agentDir: string,
    private readonly workspace: string,
  ) {}

  async inventory(
    snapshot: NativeSkillSnapshot,
    projectTrust: WebSkillInventory["projectTrust"],
    skillCommandsEnabled = true,
    permissions?: (
      skill: Skill,
    ) => Promise<{ editable: boolean; deletable: boolean }>,
  ): Promise<WebSkillInventory> {
    const skills: WebSkillResource[] = [];
    for (const skill of snapshot.skills) {
      const projectedFiles = await listSkillFiles(skill);
      const scope = canonicalSkillScope(skill, this.agentDir, this.workspace);
      const trusted =
        scope === "user" || (scope === "project" && projectTrust.trusted);
      const entry = projectedFiles.files.find((file) => file.entry);
      const permission = permissions
        ? await permissions(skill)
        : {
            editable: Boolean(trusted && entry?.kind === "text"),
            deletable: Boolean(trusted && entry?.kind !== "unavailable"),
          };
      skills.push({
        id: opaqueSkillId(skill.sourceInfo),
        name: safePromptMetadataText(skill.name).replaceAll("\n", " "),
        description: safePromptMetadataText(skill.description),
        provenance: projectResourceProvenance(skill.sourceInfo),
        source: safePromptSourceLabel(
          skill.sourceInfo,
          [
            join(this.agentDir, "skills"),
            join(this.workspace, ".pi", "skills"),
          ],
          true,
        ),
        path: safeMetadataText(
          logicalSkillPath(skill, this.agentDir, this.workspace),
        ),
        files: projectedFiles.files,
        filesTruncated: projectedFiles.truncated,
        editable: permission.editable,
        deletable: permission.deletable,
        commandEnabled: skillCommandsEnabled,
        modelInvocationEnabled: !skill.disableModelInvocation,
      });
    }
    return {
      skills,
      diagnostics: projectSkillDiagnostics(
        snapshot,
        this.agentDir,
        this.workspace,
      ),
      projectTrust,
      skillCommandsEnabled,
    };
  }

  async readFile(
    snapshot: NativeSkillSnapshot,
    id: string,
    rawPath: string,
  ): Promise<WebSkillFileDocument> {
    const skill = snapshot.skills.find(
      (candidate) => opaqueSkillId(candidate.sourceInfo) === id,
    );
    if (!skill) throw new Error("Skill not found");
    const path = parseSkillFilePath(rawPath);
    const root = await resolveSkillRoot(skill);
    if (!root) throw new Error("Skill file is unavailable");
    const inventory = await listSkillFiles(skill);
    const entry = inventory.files.find((candidate) => candidate.path === path);
    if (!entry) throw new Error("Skill file not found");
    if (entry.kind !== "text")
      return { path, size: entry.size, kind: entry.kind };

    const target = await resolveFileTarget(root.path, path);
    const before = await lstat(target.path);
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1)
      return { path, size: Math.max(0, before.size), kind: "unavailable" };
    if (before.size > MAX_SKILL_FILE_BYTES)
      return { path, size: before.size, kind: "too_large" };
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(target.path, constants.O_RDONLY | NO_FOLLOW);
      const opened = await handle.stat();
      const afterOpen = await lstat(target.path);
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        afterOpen.isSymbolicLink() ||
        !sameFile(before, opened) ||
        !sameFile(opened, afterOpen) ||
        (await realpath(target.parent)) !== target.parent
      )
        return { path, size: before.size, kind: "unavailable" };
      const raw = await readBytes(handle, before.size);
      const afterRead = await lstat(target.path);
      if (!sameFile(opened, afterRead))
        return { path, size: before.size, kind: "unavailable" };
      const content = decodeUtf8(raw);
      return content === undefined
        ? { path, size: before.size, kind: "binary" }
        : { path, size: before.size, kind: "text", content };
    } catch {
      return { path, size: Math.max(0, before.size), kind: "unavailable" };
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}
