import { realpathSync, type Stats, statSync } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import {
  isValidSkillDescription,
  isValidSkillName,
  type WebProjectTrust,
  type WebSkillWriteScope,
} from "../../shared/contracts.js";
import { opaqueSkillId } from "../api-metadata.js";
import {
  atomicCreate,
  atomicWrite,
  type ExpectedFileIdentity,
} from "./atomic-write.js";
import { ResourceConflictError, ResourcePermissionError } from "./errors.js";
import {
  MAX_SKILL_FILE_BYTES,
  type NativeSkillSnapshot,
} from "./skill-viewer.js";

interface PinnedRoot {
  path: string;
  dev: number;
  ino: number;
}

interface ManagedSkill {
  root: string;
  entry: string;
}

function pinRoot(path: string): PinnedRoot {
  const canonical = realpathSync(path);
  const stat = statSync(canonical);
  if (!stat.isDirectory()) throw new Error("Resource root must be a directory");
  return { path: canonical, dev: stat.dev, ino: stat.ino };
}

function isWithin(filePath: string, root: string): boolean {
  const path = relative(root, filePath);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

function matchesFile(
  stat: Stats,
  expected: ExpectedFileIdentity,
  includeChangeTime = true,
): boolean {
  return (
    !stat.isSymbolicLink() &&
    stat.isFile() &&
    stat.nlink === 1 &&
    stat.dev === expected.dev &&
    stat.ino === expected.ino &&
    stat.birthtimeMs === expected.birthtimeMs &&
    (!includeChangeTime || stat.ctimeMs === expected.ctimeMs) &&
    stat.size === expected.size
  );
}

function expectedFile(stat: Stats): ExpectedFileIdentity {
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)
    throw new ResourcePermissionError("Skill is read-only");
  return {
    dev: stat.dev,
    ino: stat.ino,
    birthtimeMs: stat.birthtimeMs,
    ctimeMs: stat.ctimeMs,
    size: stat.size,
  };
}

function sameDirectory(
  stat: Stats,
  expected: { dev: number; ino: number; birthtimeMs: number },
): boolean {
  return (
    !stat.isSymbolicLink() &&
    stat.isDirectory() &&
    stat.dev === expected.dev &&
    stat.ino === expected.ino &&
    stat.birthtimeMs === expected.birthtimeMs
  );
}

export function skillSkeleton(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description.trim())}\n---\n\n# ${name}\n\nAdd instructions for when and how Pi should use this skill.\n`;
}

export class SkillManager {
  private readonly agentRoot: PinnedRoot;
  private readonly workspaceRoot: PinnedRoot;

  constructor(
    private readonly agentDir: string,
    private readonly workspace: string,
  ) {
    this.agentRoot = pinRoot(agentDir);
    this.workspaceRoot = pinRoot(workspace);
  }

  private pinnedRoot(scope: WebSkillWriteScope): PinnedRoot {
    return scope === "user" ? this.agentRoot : this.workspaceRoot;
  }

  private rootSegments(scope: WebSkillWriteScope): string[] {
    return scope === "user" ? ["skills"] : [".pi", "skills"];
  }

  private lexicalRoot(scope: WebSkillWriteScope): string {
    return scope === "user"
      ? join(this.agentDir, "skills")
      : join(this.workspace, ".pi", "skills");
  }

  private async skillRoot(
    scope: WebSkillWriteScope,
    prepare: boolean,
  ): Promise<string> {
    const pinned = this.pinnedRoot(scope);
    const currentRoot = await realpath(pinned.path);
    const currentStat = await lstat(currentRoot);
    if (
      currentRoot !== pinned.path ||
      currentStat.dev !== pinned.dev ||
      currentStat.ino !== pinned.ino
    )
      throw new ResourcePermissionError("Configured resource root changed");
    let current = pinned.path;
    for (const segment of this.rootSegments(scope)) {
      const next = join(current, segment);
      let stat: Awaited<ReturnType<typeof lstat>>;
      try {
        stat = await lstat(next);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !prepare)
          throw error;
        try {
          await mkdir(next, { mode: 0o700 });
        } catch (mkdirError) {
          if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST")
            throw mkdirError;
        }
        stat = await lstat(next);
      }
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new ResourcePermissionError("Skill root is read-only");
      if ((await realpath(next)) !== next)
        throw new ResourcePermissionError("Skill root is read-only");
      current = next;
    }
    return current;
  }

  private relativeManagedEntry(
    skill: Skill,
    scope: WebSkillWriteScope,
  ): string | undefined {
    const filePath = resolve(skill.filePath);
    const roots = [resolve(this.lexicalRoot(scope))];
    const pinnedRoot = join(
      this.pinnedRoot(scope).path,
      ...this.rootSegments(scope),
    );
    if (!roots.includes(pinnedRoot)) roots.push(pinnedRoot);
    for (const root of roots) {
      if (!isWithin(filePath, root)) continue;
      const relativeEntry = relative(root, filePath);
      const segments = relativeEntry.split(sep);
      const fileName = basename(filePath);
      if (
        (fileName === "SKILL.md" && segments.length <= 2) ||
        (segments.length === 1 && fileName.endsWith(".md"))
      )
        return relativeEntry;
    }
    return undefined;
  }

  private async assertSafeParent(
    root: string,
    relativeEntry: string,
  ): Promise<string> {
    const segments = relativeEntry.split(sep);
    if (
      segments.length < 1 ||
      segments.some(
        (segment) => !segment || segment === "." || segment === "..",
      )
    )
      throw new ResourcePermissionError("Skill is read-only");
    let parent = root;
    for (const segment of segments.slice(0, -1)) {
      const next = join(parent, segment);
      const stat = await lstat(next);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new ResourcePermissionError("Skill is read-only");
      if ((await realpath(next)) !== next)
        throw new ResourcePermissionError("Skill is read-only");
      parent = next;
    }
    return parent;
  }

  private async managedSkill(
    snapshot: NativeSkillSnapshot,
    trust: WebProjectTrust,
    id: string,
  ): Promise<ManagedSkill> {
    const skill = snapshot.skills.find(
      (candidate) => opaqueSkillId(candidate.sourceInfo) === id,
    );
    if (!skill) throw new Error("Skill not found");
    if (skill.sourceInfo.origin !== "top-level")
      throw new ResourcePermissionError("Skill is read-only");
    if (
      skill.sourceInfo.scope !== "user" &&
      skill.sourceInfo.scope !== "project"
    )
      throw new ResourcePermissionError("Skill is read-only");
    const scope = skill.sourceInfo.scope;
    if (scope === "project" && !trust.trusted)
      throw new ResourcePermissionError("Project skills are not trusted");
    const relativeEntry = this.relativeManagedEntry(skill, scope);
    if (!relativeEntry) throw new ResourcePermissionError("Skill is read-only");
    const root = await this.skillRoot(scope, false).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error("Skill not found");
      throw error;
    });
    try {
      const parent = await this.assertSafeParent(root, relativeEntry);
      const entry = join(parent, basename(relativeEntry));
      if (!isWithin(entry, root))
        throw new ResourcePermissionError("Skill is read-only");
      expectedFile(await lstat(entry));
      return { root, entry };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error("Skill not found");
      throw error;
    }
  }

  async permissions(
    snapshot: NativeSkillSnapshot,
    trust: WebProjectTrust,
    skill: Skill,
  ): Promise<{ editable: boolean; deletable: boolean }> {
    try {
      const managed = await this.managedSkill(
        snapshot,
        trust,
        opaqueSkillId(skill.sourceInfo),
      );
      const stat = await lstat(managed.entry);
      expectedFile(stat);
      return {
        editable: stat.size <= MAX_SKILL_FILE_BYTES,
        deletable: true,
      };
    } catch {
      return { editable: false, deletable: false };
    }
  }

  async create(
    snapshot: NativeSkillSnapshot,
    trust: WebProjectTrust,
    scope: WebSkillWriteScope,
    name: string,
    description: string,
  ): Promise<void> {
    if (!isValidSkillName(name) || !isValidSkillDescription(description))
      throw new Error("Skill metadata is invalid");
    if (scope === "project" && !trust.trusted)
      throw new ResourcePermissionError("Project skills are not trusted");
    if (snapshot.skills.some((skill) => skill.name === name))
      throw new ResourceConflictError("Skill name already exists");
    const root = await this.skillRoot(scope, true);
    const directory = join(root, name);
    let created = false;
    try {
      await mkdir(directory, { mode: 0o700 });
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await lstat(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new ResourceConflictError("Skill already exists");
      if ((await readdir(directory)).length > 0)
        throw new ResourceConflictError("Skill already exists");
    }
    if ((await realpath(directory)) !== directory) {
      if (created) await rmdir(directory).catch(() => undefined);
      throw new ResourcePermissionError("Skill directory is read-only");
    }
    try {
      await atomicCreate(
        join(directory, "SKILL.md"),
        skillSkeleton(name, description),
        directory,
      );
    } catch (error) {
      if (created) await rmdir(directory).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new ResourceConflictError("Skill already exists");
      throw error;
    }
  }

  async update(
    snapshot: NativeSkillSnapshot,
    trust: WebProjectTrust,
    id: string,
    content: string,
  ): Promise<void> {
    if (Buffer.byteLength(content) > MAX_SKILL_FILE_BYTES)
      throw new Error("Skill document is too large");
    const managed = await this.managedSkill(snapshot, trust, id);
    const stat = await lstat(managed.entry);
    const expected = expectedFile(stat);
    try {
      await atomicWrite(
        managed.entry,
        content,
        0o600,
        dirname(managed.entry),
        expected,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        /(changed before persistence|resource not found)/i.test(error.message)
      )
        throw new ResourceConflictError("Skill changed during mutation");
      throw error;
    }
  }

  private async deleteFile(path: string): Promise<void> {
    const parent = dirname(path);
    const expected = expectedFile(await lstat(path));
    const quarantine = join(
      parent,
      `.${basename(path)}.${crypto.randomUUID()}.delete`,
    );
    await rename(path, quarantine);
    let deleted = false;
    try {
      if (!matchesFile(await lstat(quarantine), expected, false))
        throw new ResourceConflictError("Skill changed during deletion");
      await rm(quarantine);
      deleted = true;
    } finally {
      if (!deleted) {
        try {
          await rename(quarantine, path);
        } catch {
          // Preserve the quarantined file if the original name was reused.
        }
      }
    }
  }

  private async deleteDirectory(entry: string, root: string): Promise<void> {
    const directory = dirname(entry);
    const parent = dirname(directory);
    if (!isWithin(directory, root) || directory === root)
      throw new ResourcePermissionError("Skill is read-only");
    const expectedEntry = expectedFile(await lstat(entry));
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new ResourcePermissionError("Skill is read-only");
    const expected = {
      dev: stat.dev,
      ino: stat.ino,
      birthtimeMs: stat.birthtimeMs,
    };
    const quarantine = join(
      parent,
      `.${basename(directory)}.${crypto.randomUUID()}.delete`,
    );
    await rename(directory, quarantine);
    let deleted = false;
    try {
      if (!sameDirectory(await lstat(quarantine), expected))
        throw new ResourceConflictError("Skill changed during deletion");
      const movedEntry = join(quarantine, basename(entry));
      if (!matchesFile(await lstat(movedEntry), expectedEntry, false))
        throw new ResourceConflictError("Skill changed during deletion");
      await rm(quarantine, { recursive: true });
      deleted = true;
    } finally {
      if (!deleted) {
        try {
          await rename(quarantine, directory);
        } catch {
          // Preserve the quarantined directory if the original name was reused.
        }
      }
    }
  }

  async delete(
    snapshot: NativeSkillSnapshot,
    trust: WebProjectTrust,
    id: string,
  ): Promise<void> {
    const managed = await this.managedSkill(snapshot, trust, id);
    try {
      if (
        basename(managed.entry) === "SKILL.md" &&
        dirname(managed.entry) !== managed.root
      ) {
        await this.deleteDirectory(managed.entry, managed.root);
      } else {
        await this.deleteFile(managed.entry);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new ResourceConflictError("Skill changed during deletion");
      throw error;
    }
  }
}
