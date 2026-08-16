import { constants, realpathSync, statSync } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type {
  PackageManager,
  PromptTemplate,
} from "@earendil-works/pi-coding-agent";
import type {
  WebPackageSummary,
  WebProjectTrust,
  WebPromptResource,
  WebPromptTemplateDocument,
  WebPromptWriteScope,
} from "../../shared/contracts.js";
import {
  opaquePackageId,
  opaquePromptId,
  projectPackageSummary,
  projectResourceProvenance,
  safeMetadataText,
  safePromptMetadataText,
  safePromptSourceLabel,
} from "../api-metadata.js";
import {
  atomicCreate,
  atomicWrite,
  type ExpectedFileIdentity,
} from "./atomic-write.js";
import { safeMarkdownPath } from "./paths.js";

export type DocumentKind = "append" | "heartbeat" | "system" | "template";

interface PromptMutationTarget extends ExpectedFileIdentity {
  parent: string;
  path: string;
}

type PackageOperations = Pick<
  PackageManager,
  "installAndPersist" | "listConfiguredPackages" | "removeAndPersist" | "update"
>;

/** Application adapter for Pi's native prompt snapshot and reload lifecycle. */
export interface NativeResourceRuntime {
  reload(): Promise<void>;
  mutateResources<T>(operation: () => Promise<T>): Promise<T>;
  projectTrust(): WebProjectTrust;
  promptTemplates(): ReadonlyArray<PromptTemplate>;
}

export class ResourceConflictError extends Error {}

export class ResourcePermissionError extends Error {}

const MAX_PROMPT_CONTENT = 1_000_000;

export function noFollowReadFlags(noFollow: number | undefined): number {
  return constants.O_RDONLY | (noFollow ?? 0);
}

function matchesPromptTarget(
  current: Awaited<ReturnType<typeof lstat>>,
  target: PromptMutationTarget,
  includeChangeTime = true,
): boolean {
  return (
    !current.isSymbolicLink() &&
    current.isFile() &&
    current.nlink === 1 &&
    current.dev === target.dev &&
    current.ino === target.ino &&
    current.birthtimeMs === target.birthtimeMs &&
    (!includeChangeTime || current.ctimeMs === target.ctimeMs) &&
    current.size === target.size
  );
}

function sameFileIdentity(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.ctimeMs === right.ctimeMs &&
    left.size === right.size
  );
}

interface PinnedRoot {
  path: string;
  dev: number;
  ino: number;
}

function pinRoot(path: string): PinnedRoot {
  const canonical = realpathSync(path);
  const stat = statSync(canonical);
  if (!stat.isDirectory()) throw new Error("Resource root must be a directory");
  return { path: canonical, dev: stat.dev, ino: stat.ino };
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > maximumBytes) break;
    bytes += characterBytes;
    end += character.length;
  }
  return value.slice(0, end);
}

/** Mirrors Pi's first-winner prompt-path order for create conflicts. */
function promptPrecedence(prompt: PromptTemplate): number {
  if (
    prompt.sourceInfo.scope === "temporary" &&
    (prompt.sourceInfo.origin === "package" ||
      prompt.sourceInfo.source === "cli")
  )
    return -1;
  if (prompt.sourceInfo.origin === "package") return 4;
  if (prompt.sourceInfo.scope === "temporary") return 5;
  const scopeRank = prompt.sourceInfo.scope === "project" ? 0 : 2;
  return scopeRank + (prompt.sourceInfo.source === "local" ? 0 : 1);
}

function isWithin(path: string, root: string): boolean {
  const target = resolve(path);
  const boundary = resolve(root);
  return target === boundary || target.startsWith(`${boundary}${sep}`);
}

function logicalRelative(path: string, root: string): string {
  return relative(root, path).split(sep).join("/");
}

function packageSource(value: string): string {
  const source = value.trim();
  if (source.length < 1 || source.length > 2_048 || /[\r\n\0]/.test(source)) {
    throw new Error("Package source is invalid");
  }
  if (
    !/^(?:npm:|git:|git:\/\/|https?:\/\/|ssh:\/\/|\/|\.{1,2}\/)/.test(source)
  ) {
    throw new Error(
      "Package source must be npm, git, URL, or a relative or absolute container path",
    );
  }
  return source;
}

export class ResourceService {
  private readonly agentRoot: PinnedRoot;
  private readonly promptDir: string;
  private readonly workspaceRoot: PinnedRoot;

  constructor(
    private readonly agentDir: string,
    private readonly workspace: string,
    private readonly packages: PackageOperations,
    private readonly runtime: NativeResourceRuntime,
    private readonly noFollowFlag: number | null = (
      constants as unknown as Record<string, number | undefined>
    ).O_NOFOLLOW ?? null,
  ) {
    this.agentRoot = pinRoot(agentDir);
    this.promptDir = join(agentDir, "prompts");
    this.workspaceRoot = pinRoot(workspace);
  }

  private documentPath(kind: DocumentKind, name?: string): string {
    if (kind === "template") {
      if (!name) throw new Error("Template name is required");
      return safeMarkdownPath(this.promptDir, name);
    }
    if (name) throw new Error("This document does not accept a name");
    return join(
      this.agentDir,
      kind === "system"
        ? "SYSTEM.md"
        : kind === "append"
          ? "APPEND_SYSTEM.md"
          : "HEARTBEAT.md",
    );
  }

  private async assertSafeParent(
    path: string,
    boundary = this.agentDir,
    prepare = false,
  ): Promise<string> {
    const target = resolve(path);
    const managedBoundary = resolve(boundary);
    const parentPath = dirname(target);
    if (!isWithin(parentPath, managedBoundary))
      throw new Error("Resource path escapes its managed directory");
    const boundaryStat = await lstat(managedBoundary);
    const pinnedRoot =
      managedBoundary === resolve(this.agentDir)
        ? this.agentRoot
        : managedBoundary === resolve(this.workspace)
          ? this.workspaceRoot
          : undefined;
    if (
      (!pinnedRoot && boundaryStat.isSymbolicLink()) ||
      (!boundaryStat.isSymbolicLink() && !boundaryStat.isDirectory())
    )
      throw new Error("Resource boundary must be a real directory");
    const root = await realpath(managedBoundary);
    const rootStat = await lstat(root);
    if (
      pinnedRoot &&
      (root !== pinnedRoot.path ||
        rootStat.dev !== pinnedRoot.dev ||
        rootStat.ino !== pinnedRoot.ino)
    )
      throw new Error("Configured resource root changed");
    let parent = root;
    const segments = relative(managedBoundary, parentPath)
      .split(sep)
      .filter(Boolean);
    for (const segment of segments) {
      const currentStat = await lstat(parent);
      if (currentStat.isSymbolicLink() || !currentStat.isDirectory())
        throw new Error("Resource parent must be a real directory");
      const next = join(parent, segment);
      let stat: Awaited<ReturnType<typeof lstat>>;
      try {
        stat = await lstat(next);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !prepare)
          throw error;
        try {
          await mkdir(next);
        } catch (mkdirError) {
          if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST")
            throw mkdirError;
        }
        stat = await lstat(next);
      }
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error("Resource parent must be a real directory");
      const nextRealPath = await realpath(next);
      if (!isWithin(nextRealPath, root))
        throw new Error("Resource path escapes its managed directory");
      parent = nextRealPath;
    }
    const realTarget = join(parent, basename(target));
    try {
      const stat = await lstat(realTarget);
      if (stat.isSymbolicLink())
        throw new Error("Resource file cannot be a symbolic link");
      if (stat.isFile() && stat.nlink > 1)
        throw new Error("Resource file cannot have multiple hard links");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return parent;
  }

  private async readSafeFile(
    path: string,
    boundary: string,
    maximumBytes?: number,
    truncate = false,
  ): Promise<{ content: string; truncated: boolean }> {
    const expectedParent = await this.assertSafeParent(path, boundary);
    const safePath = join(expectedParent, basename(path));
    const before = await lstat(safePath);
    if (before.isSymbolicLink() || !before.isFile() || before.nlink > 1)
      throw new Error("Resource is not a single-link regular file");
    const handle = await open(
      safePath,
      noFollowReadFlags(this.noFollowFlag ?? undefined),
    );
    try {
      const stat = await handle.stat();
      const afterOpen = await lstat(safePath);
      if (
        !stat.isFile() ||
        stat.nlink > 1 ||
        afterOpen.isSymbolicLink() ||
        !afterOpen.isFile() ||
        afterOpen.nlink > 1 ||
        !sameFileIdentity(before, stat) ||
        !sameFileIdentity(stat, afterOpen)
      )
        throw new Error("Resource changed during read");
      const truncated = maximumBytes !== undefined && stat.size > maximumBytes;
      if (truncated && !truncate) throw new Error("Resource is too large");
      if ((await realpath(dirname(safePath))) !== expectedParent)
        throw new Error("Resource parent changed during read");
      let result: { content: string; truncated: boolean };
      if (truncated && maximumBytes !== undefined) {
        const buffer = Buffer.alloc(maximumBytes + 4);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        result = {
          content: truncateUtf8(
            buffer.subarray(0, bytesRead).toString("utf8"),
            maximumBytes,
          ),
          truncated: true,
        };
      } else {
        result = {
          content: await handle.readFile({ encoding: "utf8" }),
          truncated: false,
        };
      }
      const afterRead = await lstat(safePath);
      if (
        afterRead.isSymbolicLink() ||
        !afterRead.isFile() ||
        afterRead.nlink > 1 ||
        !sameFileIdentity(stat, afterRead)
      )
        throw new Error("Resource changed during read");
      return result;
    } finally {
      await handle.close();
    }
  }

  async readDocument(
    kind: DocumentKind,
    name?: string,
  ): Promise<string | undefined> {
    const path = this.documentPath(kind, name);
    try {
      return (await this.readSafeFile(path, this.agentDir)).content;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async writeDocument(
    kind: DocumentKind,
    name: string | undefined,
    content: string,
  ): Promise<void> {
    if (kind === "template") {
      if (!name) throw new Error("Template name is required");
      await this.upsertUserTemplate(name, content);
      return;
    }
    if (Buffer.byteLength(content) > 1_000_000)
      throw new Error("Document is too large");
    const path = this.documentPath(kind, name);
    const parent = await this.assertSafeParent(path, this.agentDir, true);
    await atomicWrite(path, content, 0o600, parent);
    await this.runtime.reload();
  }

  async deleteDocument(kind: DocumentKind, name?: string): Promise<void> {
    if (kind === "template") {
      if (!name) throw new Error("Template name is required");
      await this.deleteUserTemplate(name);
      return;
    }
    const path = this.documentPath(kind, name);
    try {
      const parent = await this.assertSafeParent(path);
      await rm(join(parent, basename(path)), { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await this.runtime.reload();
  }

  async listTemplates(): Promise<WebPromptTemplateDocument[]> {
    const documents = await Promise.all(
      this.runtime
        .promptTemplates()
        .filter((prompt) => this.canonicalPromptScope(prompt) === "user")
        .map(async (prompt) => {
          const projected = await this.projectPrompt(prompt);
          if (!projected.editable) return undefined;
          return {
            name: projected.name,
            content: projected.content,
            provenance: projected.provenance,
          };
        }),
    );
    return documents
      .filter(
        (document): document is WebPromptTemplateDocument =>
          document !== undefined,
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private promptRoot(scope: WebPromptWriteScope): string {
    return scope === "user"
      ? this.promptDir
      : join(this.workspace, ".pi", "prompts");
  }

  private promptBoundary(scope: WebPromptWriteScope): string {
    return scope === "user" ? this.agentDir : this.workspace;
  }

  private canonicalPromptScope(
    prompt: PromptTemplate,
  ): WebPromptWriteScope | undefined {
    if (prompt.sourceInfo.origin !== "top-level") return undefined;
    if (
      prompt.sourceInfo.scope !== "user" &&
      prompt.sourceInfo.scope !== "project"
    )
      return undefined;
    const scope = prompt.sourceInfo.scope;
    if (resolve(dirname(prompt.filePath)) !== resolve(this.promptRoot(scope)))
      return undefined;
    return scope;
  }

  private async isEditablePrompt(prompt: PromptTemplate): Promise<boolean> {
    const scope = this.canonicalPromptScope(prompt);
    if (!scope) return false;
    if (
      prompt.sourceInfo.scope === "project" &&
      !this.runtime.projectTrust().trusted
    )
      return false;
    try {
      await this.assertSafeParent(prompt.filePath, this.promptBoundary(scope));
      return (await lstat(prompt.filePath)).isFile();
    } catch {
      return false;
    }
  }

  private async promptReadBoundary(
    prompt: PromptTemplate,
    scope: WebPromptWriteScope | undefined,
  ): Promise<string> {
    if (scope) return this.promptBoundary(scope);
    const filePath = resolve(prompt.filePath);
    if (isWithin(filePath, this.agentDir)) return this.agentDir;
    if (isWithin(filePath, this.workspace)) return this.workspace;
    const boundary = resolve(
      prompt.sourceInfo.baseDir ?? dirname(prompt.filePath),
    );
    if ((await realpath(boundary)) !== boundary)
      throw new Error("External prompt boundary cannot contain symbolic links");
    return boundary;
  }

  private promptSourceLabel(prompt: PromptTemplate): string {
    return safePromptSourceLabel(prompt.sourceInfo, [
      this.promptDir,
      this.promptRoot("project"),
    ]);
  }

  private logicalPromptPath(prompt: PromptTemplate): string {
    const source = this.promptSourceLabel(prompt);
    if (
      prompt.sourceInfo.origin === "top-level" &&
      prompt.sourceInfo.scope === "user" &&
      resolve(dirname(prompt.filePath)) === resolve(this.promptDir)
    )
      return `~/.pi/agent/prompts/${logicalRelative(prompt.filePath, this.promptDir)}`;
    const projectRoot = this.promptRoot("project");
    if (
      prompt.sourceInfo.origin === "top-level" &&
      prompt.sourceInfo.scope === "project" &&
      resolve(dirname(prompt.filePath)) === resolve(projectRoot)
    )
      return `.pi/prompts/${logicalRelative(prompt.filePath, projectRoot)}`;
    if (prompt.sourceInfo.origin === "package") {
      const relativePath =
        prompt.sourceInfo.baseDir &&
        isWithin(prompt.filePath, prompt.sourceInfo.baseDir)
          ? logicalRelative(prompt.filePath, prompt.sourceInfo.baseDir)
          : basename(prompt.filePath);
      return `packages/${source}/${relativePath}`;
    }
    const prefix =
      prompt.sourceInfo.scope === "temporary" ? "temporary" : "settings";
    return `${prefix}/${basename(prompt.filePath)}`;
  }

  private async projectPrompt(
    prompt: PromptTemplate,
  ): Promise<WebPromptResource> {
    const scope = this.canonicalPromptScope(prompt);
    const canonical = scope !== undefined;
    const deletable = await this.isEditablePrompt(prompt);
    let editable = deletable;
    let rawContentTruncated = false;
    let description = "";
    let argumentHint: string | undefined;
    let content = "";
    const snapshotContent =
      typeof prompt.content === "string" ? prompt.content : "";
    const projectAllowed =
      prompt.sourceInfo.scope !== "project" ||
      this.runtime.projectTrust().trusted;
    if (projectAllowed) {
      try {
        const raw = await this.readSafeFile(
          prompt.filePath,
          await this.promptReadBoundary(prompt, scope),
          MAX_PROMPT_CONTENT,
          true,
        );
        content = canonical ? raw.content : snapshotContent;
        rawContentTruncated = canonical && raw.truncated;
        if (raw.truncated && canonical) editable = false;
        description =
          typeof prompt.description === "string" ? prompt.description : "";
        if (!description) {
          const firstLine = snapshotContent
            .split("\n")
            .find((line) => line.trim());
          if (firstLine) {
            description = firstLine.slice(0, 60);
            if (firstLine.length > 60) description += "...";
          }
        }
        argumentHint =
          typeof prompt.argumentHint === "string"
            ? prompt.argumentHint
            : undefined;
      } catch {
        editable = false;
        content = "";
        description = "";
        argumentHint = undefined;
      }
    } else {
      editable = false;
    }
    const contentTruncated =
      rawContentTruncated || Buffer.byteLength(content) > MAX_PROMPT_CONTENT;
    if (contentTruncated) editable = false;
    return {
      id: opaquePromptId(prompt.sourceInfo),
      name: safePromptMetadataText(prompt.name).replaceAll("\n", " "),
      description: safePromptMetadataText(description),
      ...(argumentHint
        ? { argumentHint: safePromptMetadataText(argumentHint) }
        : {}),
      content: contentTruncated
        ? truncateUtf8(content, MAX_PROMPT_CONTENT)
        : content,
      contentTruncated,
      provenance: projectResourceProvenance(prompt.sourceInfo),
      source: this.promptSourceLabel(prompt),
      path: safeMetadataText(this.logicalPromptPath(prompt)),
      editable,
      deletable,
    };
  }

  async listPromptResources(): Promise<WebPromptResource[]> {
    return Promise.all(
      this.runtime
        .promptTemplates()
        .map((prompt) => this.projectPrompt(prompt)),
    );
  }

  private nativePrompt(id: string): PromptTemplate {
    const prompt = this.runtime
      .promptTemplates()
      .find((candidate) => opaquePromptId(candidate.sourceInfo) === id);
    if (!prompt) throw new Error("Prompt not found");
    return prompt;
  }

  private assertProjectWritable(scope: WebPromptWriteScope): void {
    if (scope === "project" && !this.runtime.projectTrust().trusted)
      throw new ResourcePermissionError("Project prompts are not trusted");
  }

  private assertNoHigherPrecedenceWinner(
    scope: WebPromptWriteScope,
    name: string,
    path: string,
  ): void {
    const createPrecedence = scope === "project" ? 1 : 3;
    const winner = this.runtime
      .promptTemplates()
      .find((prompt) => prompt.name === name);
    if (
      winner &&
      resolve(winner.filePath) !== resolve(path) &&
      promptPrecedence(winner) <= createPrecedence
    )
      throw new ResourceConflictError(
        "A higher-precedence prompt already uses this name",
      );
  }

  private async promptMutationTarget(
    path: string,
    parent: string,
  ): Promise<PromptMutationTarget | undefined> {
    const safePath = join(parent, basename(path));
    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(safePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1)
      throw new ResourcePermissionError("Prompt is read-only");
    return {
      path: safePath,
      parent,
      dev: stat.dev,
      ino: stat.ino,
      birthtimeMs: stat.birthtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size,
    };
  }

  private async assertPromptTarget(
    target: PromptMutationTarget,
  ): Promise<void> {
    let current: Awaited<ReturnType<typeof lstat>>;
    try {
      current = await lstat(target.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error("Prompt not found");
      throw error;
    }
    if (!matchesPromptTarget(current, target))
      throw new ResourceConflictError("Prompt changed during mutation");
  }

  private async persistPromptTarget(
    target: PromptMutationTarget,
    content: string,
  ): Promise<void> {
    await this.assertPromptTarget(target);
    try {
      await atomicWrite(target.path, content, 0o600, target.parent, target);
    } catch (error) {
      if (
        error instanceof Error &&
        /changed before persistence/i.test(error.message)
      )
        throw new ResourceConflictError("Prompt changed during mutation");
      throw error;
    }
  }

  private async deletePromptTarget(
    target: PromptMutationTarget,
  ): Promise<void> {
    await this.assertPromptTarget(target);
    const quarantine = join(
      target.parent,
      `.${basename(target.path)}.${crypto.randomUUID()}.delete`,
    );
    const beforeMove = await lstat(target.path).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error("Prompt not found");
      throw error;
    });
    if (!matchesPromptTarget(beforeMove, target))
      throw new ResourceConflictError("Prompt changed during deletion");
    try {
      await rename(target.path, quarantine);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error("Prompt not found");
      throw error;
    }
    let deleted = false;
    try {
      const moved = await lstat(quarantine);
      if (!matchesPromptTarget(moved, target, false))
        throw new ResourceConflictError("Prompt changed during deletion");
      await rm(quarantine);
      deleted = true;
    } catch (error) {
      if (!deleted) {
        try {
          await link(quarantine, target.path);
          await rm(quarantine);
        } catch {
          // Preserve the moved file at its private path if the name was reused.
        }
      }
      throw error;
    }
    try {
      await lstat(target.path);
      throw new ResourceConflictError("Prompt was replaced during deletion");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async upsertUserTemplate(
    name: string,
    content: string,
  ): Promise<void> {
    await this.runtime.mutateResources(async () => {
      if (Buffer.byteLength(content) > MAX_PROMPT_CONTENT)
        throw new Error("Document is too large");
      const path = safeMarkdownPath(this.promptRoot("user"), name);
      const promptName = basename(path).slice(0, -3);
      this.assertNoHigherPrecedenceWinner("user", promptName, path);
      let parent: string;
      try {
        parent = await this.assertSafeParent(
          path,
          this.promptBoundary("user"),
          true,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
        throw new ResourcePermissionError("Prompt is read-only");
      }
      const target = await this.promptMutationTarget(path, parent);
      const active = this.runtime
        .promptTemplates()
        .find(
          (prompt) =>
            prompt.name === promptName &&
            resolve(prompt.filePath) === resolve(path),
        );
      if (active && !(await this.projectPrompt(active)).editable)
        throw new ResourcePermissionError("Prompt is read-only");
      if (target) {
        await this.persistPromptTarget(target, content);
      } else {
        try {
          await atomicCreate(path, content, parent);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST")
            throw new ResourceConflictError("Prompt already exists");
          throw error;
        }
      }
    });
  }

  private async deleteUserTemplate(name: string): Promise<void> {
    await this.runtime.mutateResources(async () => {
      const path = safeMarkdownPath(this.promptRoot("user"), name);
      const promptName = basename(path).slice(0, -3);
      this.assertNoHigherPrecedenceWinner("user", promptName, path);
      try {
        const parent = await this.assertSafeParent(
          path,
          this.promptBoundary("user"),
        );
        const target = await this.promptMutationTarget(path, parent);
        if (target) await this.deletePromptTarget(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    });
  }

  async createPromptResource(
    scope: WebPromptWriteScope,
    name: string,
    content: string,
  ): Promise<void> {
    await this.runtime.mutateResources(async () => {
      this.assertProjectWritable(scope);
      const path = safeMarkdownPath(this.promptRoot(scope), name);
      const promptName = basename(path).slice(0, -3);
      let existingParent: string | undefined;
      try {
        existingParent = await this.assertSafeParent(
          path,
          this.promptBoundary(scope),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (existingParent) {
        try {
          await lstat(join(existingParent, basename(path)));
          throw new ResourceConflictError("Prompt already exists");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      this.assertNoHigherPrecedenceWinner(scope, promptName, path);
      if (Buffer.byteLength(content) > MAX_PROMPT_CONTENT)
        throw new Error("Document is too large");
      const parent = await this.assertSafeParent(
        path,
        this.promptBoundary(scope),
        true,
      );
      try {
        await atomicCreate(path, content, parent);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new ResourceConflictError("Prompt already exists");
        throw error;
      }
    });
  }

  async updatePromptResource(id: string, content: string): Promise<void> {
    await this.runtime.mutateResources(async () => {
      if (Buffer.byteLength(content) > MAX_PROMPT_CONTENT)
        throw new Error("Document is too large");
      const prompt = this.nativePrompt(id);
      const scope = this.canonicalPromptScope(prompt);
      if (!scope) throw new ResourcePermissionError("Prompt is read-only");
      this.assertProjectWritable(scope);
      let parent: string;
      try {
        parent = await this.assertSafeParent(
          prompt.filePath,
          this.promptBoundary(scope),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new Error("Prompt not found");
        throw new ResourcePermissionError("Prompt is read-only");
      }
      const target = await this.promptMutationTarget(prompt.filePath, parent);
      if (!target) throw new Error("Prompt not found");
      await this.persistPromptTarget(target, content);
    });
  }

  async deletePromptResource(id: string): Promise<void> {
    await this.runtime.mutateResources(async () => {
      const prompt = this.nativePrompt(id);
      const scope = this.canonicalPromptScope(prompt);
      if (!scope) throw new ResourcePermissionError("Prompt is read-only");
      this.assertProjectWritable(scope);
      let parent: string;
      try {
        parent = await this.assertSafeParent(
          prompt.filePath,
          this.promptBoundary(scope),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new Error("Prompt not found");
        throw new ResourcePermissionError("Prompt is read-only");
      }
      const target = await this.promptMutationTarget(prompt.filePath, parent);
      if (!target) throw new Error("Prompt not found");
      await this.deletePromptTarget(target);
    });
  }

  private packageSourceForId(id: string): string {
    const item = this.packages
      .listConfiguredPackages()
      .find(
        (candidate) =>
          opaquePackageId(candidate.scope, candidate.source) === id,
      );
    if (!item) throw new Error("Package not found");
    return item.source;
  }

  listPackages(): WebPackageSummary[] {
    return this.packages.listConfiguredPackages().map(projectPackageSummary);
  }

  async installPackage(value: string): Promise<void> {
    await this.packages.installAndPersist(packageSource(value));
    await this.runtime.reload();
  }

  async removePackage(id: string): Promise<boolean> {
    const removed = await this.packages.removeAndPersist(
      this.packageSourceForId(id),
    );
    if (removed) await this.runtime.reload();
    return removed;
  }

  async updatePackage(id?: string): Promise<void> {
    await this.packages.update(id ? this.packageSourceForId(id) : undefined);
    await this.runtime.reload();
  }
}
