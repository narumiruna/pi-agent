import { createHash, randomUUID } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import {
  access,
  link,
  lstat,
  open,
  opendir,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import type {
  WorkspaceDirectory,
  WorkspaceEntry,
  WorkspaceFile,
} from "../../shared/contracts.js";
import { mapWorkspaceFsError, WorkspaceError } from "./errors.js";
import {
  createOperationGuard,
  createWorkspaceBoundary,
  isHiddenWorkspaceEntry,
  parseWorkspaceBasename,
  resolveWorkspaceParent,
  resolveWorkspaceTarget,
  type WorkspaceBoundary,
  type WorkspaceTarget,
} from "./policy.js";

export const MAX_WORKSPACE_DIRECTORY_ENTRIES = 500;
export const MAX_WORKSPACE_TEXT_BYTES = 1_000_000;
export const MAX_WORKSPACE_DOWNLOAD_BYTES = 100_000_000;

const READ_CHUNK_BYTES = 64 * 1_024;

export interface WorkspaceDownload {
  name: string;
  size: number;
  stream: ReadableStream<Uint8Array>;
}

function revisionFromStat(stat: BigIntStats): string {
  return createHash("sha256")
    .update(
      [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":"),
    )
    .digest("base64url");
}

function modifiedAt(stat: BigIntStats): number {
  return Number(stat.mtimeNs / 1_000_000n);
}

function entryFromTarget(target: WorkspaceTarget): WorkspaceEntry {
  return {
    path: target.path,
    name: basename(target.path),
    kind: target.stat.isDirectory() ? "directory" : "file",
    modifiedAt: modifiedAt(target.stat),
    ...(target.stat.isFile() ? { size: Number(target.stat.size) } : {}),
  };
}

async function directoryWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function readBounded(
  handle: Awaited<ReturnType<typeof open>>,
  limit: number,
  guard: () => void,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= limit) {
    guard();
    const chunk = Buffer.allocUnsafe(
      Math.min(READ_CHUNK_BYTES, limit + 1 - total),
    );
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total > limit) throw new WorkspaceError(413, "too_large");
  return Buffer.concat(chunks, total);
}

function decodeText(content: Buffer): string | undefined {
  if (content.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      content,
    );
  } catch {
    return undefined;
  }
}

async function openNoFollow(path: string) {
  try {
    return await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    return mapWorkspaceFsError(error);
  }
}

async function temporaryFile(
  directory: string,
  content: string,
  mode: number,
  preserveMode = false,
): Promise<string> {
  const path = join(directory, `.pi-agent-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      mode,
    );
    if (preserveMode) await handle.chmod(mode);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    return path;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(path, { force: true }).catch(() => undefined);
    return mapWorkspaceFsError(error);
  }
}

function assertRevision(stat: BigIntStats, expected: string): void {
  if (revisionFromStat(stat) !== expected) {
    throw new WorkspaceError(409, "stale");
  }
}

export class WorkspaceService {
  private mutationTail = Promise.resolve();

  constructor(
    private readonly workspace: string,
    private readonly excludePaths: readonly string[] = [],
  ) {}

  private boundary(): Promise<WorkspaceBoundary> {
    return createWorkspaceBoundary(this.workspace, this.excludePaths);
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async listDirectory(
    path: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceDirectory> {
    const guard = createOperationGuard(signal);
    const boundary = await this.boundary();
    const directory = await resolveWorkspaceTarget(boundary, path, "directory");
    const entries: WorkspaceEntry[] = [];
    let truncated = false;
    let handle: Awaited<ReturnType<typeof opendir>>;
    try {
      handle = await opendir(directory.absolute);
    } catch (error) {
      return mapWorkspaceFsError(error);
    }

    try {
      for await (const rawEntry of handle) {
        guard();
        if (
          rawEntry.isSymbolicLink() ||
          isHiddenWorkspaceEntry(rawEntry.name, rawEntry.isDirectory())
        ) {
          continue;
        }
        const childPath = directory.path
          ? `${directory.path}/${rawEntry.name}`
          : rawEntry.name;
        try {
          const child = await resolveWorkspaceTarget(
            boundary,
            childPath,
            "either",
          );
          if (!child.stat.isDirectory() && !child.stat.isFile()) continue;
          if (entries.length === MAX_WORKSPACE_DIRECTORY_ENTRIES) {
            truncated = true;
            break;
          }
          entries.push(entryFromTarget(child));
        } catch (error) {
          if (error instanceof WorkspaceError && error.status === 404) continue;
          throw error;
        }
      }
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      return mapWorkspaceFsError(error);
    }

    entries.sort(
      (left, right) =>
        Number(right.kind === "directory") -
          Number(left.kind === "directory") ||
        left.name.localeCompare(right.name),
    );
    return {
      path: directory.path,
      entries,
      truncated,
      writable: await directoryWritable(directory.absolute),
    };
  }

  async inspectFile(
    path: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceFile> {
    const guard = createOperationGuard(signal);
    const boundary = await this.boundary();
    const target = await resolveWorkspaceTarget(boundary, path, "file");
    return this.inspectTarget(target, guard);
  }

  private async inspectTarget(
    target: WorkspaceTarget,
    guard: () => void,
  ): Promise<WorkspaceFile> {
    guard();
    const writable = await directoryWritable(dirname(target.absolute));
    const handle = await openNoFollow(target.absolute);
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile()) throw new WorkspaceError(415, "unsupported");
      if (revisionFromStat(before) !== revisionFromStat(target.stat)) {
        throw new WorkspaceError(404, "not_found");
      }
      const base = {
        ...entryFromTarget({ ...target, stat: before }),
        kind: "file" as const,
        size: Number(before.size),
        revision: revisionFromStat(before),
        downloadable: before.size <= BigInt(MAX_WORKSPACE_DOWNLOAD_BYTES),
        writable,
      };
      if (before.size > BigInt(MAX_WORKSPACE_TEXT_BYTES)) {
        return {
          ...base,
          editable: false,
          reason: "too_large",
        };
      }
      const raw = await readBounded(handle, MAX_WORKSPACE_TEXT_BYTES, guard);
      const after = await handle.stat({ bigint: true });
      assertRevision(after, base.revision);
      const content = decodeText(raw);
      if (content === undefined) {
        return {
          ...base,
          editable: false,
          reason: "binary",
        };
      }
      return {
        ...base,
        editable: writable,
        content,
        ...(writable ? {} : { reason: "read_only" as const }),
      };
    } finally {
      await handle.close();
    }
  }

  async writeFile(input: {
    path: string;
    content: string;
    revision?: string;
  }): Promise<WorkspaceFile> {
    const content = Buffer.from(input.content, "utf8");
    if (content.includes(0)) throw new WorkspaceError(415, "binary");
    if (content.byteLength > MAX_WORKSPACE_TEXT_BYTES) {
      throw new WorkspaceError(413, "too_large");
    }
    return this.mutate(async () => {
      const guard = createOperationGuard();
      const boundary = await this.boundary();
      const parent = await resolveWorkspaceParent(boundary, input.path);
      guard();

      if (input.revision === undefined) {
        try {
          const existing = await lstat(parent.absolute, { bigint: true });
          if (existing.isSymbolicLink()) {
            throw new WorkspaceError(404, "not_found");
          }
          throw new WorkspaceError(409, "exists");
        } catch (error) {
          if (error instanceof WorkspaceError) throw error;
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            return mapWorkspaceFsError(error);
          }
        }
        const temporary = await temporaryFile(
          parent.parent.absolute,
          input.content,
          0o644,
        );
        try {
          await link(temporary, parent.absolute);
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => undefined);
          return mapWorkspaceFsError(error);
        }
        try {
          await rm(temporary, { force: true });
        } catch (error) {
          await unlink(parent.absolute).catch(() => undefined);
          return mapWorkspaceFsError(error);
        }
      } else {
        const current = await resolveWorkspaceTarget(
          boundary,
          input.path,
          "file",
        );
        assertRevision(current.stat, input.revision);
        const mode = Number(current.stat.mode & 0o777n);
        const temporary = await temporaryFile(
          parent.parent.absolute,
          input.content,
          mode,
          true,
        );
        try {
          const latest = await resolveWorkspaceTarget(
            boundary,
            input.path,
            "file",
          );
          assertRevision(latest.stat, input.revision);
          await rename(temporary, latest.absolute);
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => undefined);
          if (error instanceof WorkspaceError) throw error;
          return mapWorkspaceFsError(error);
        }
      }

      const written = await resolveWorkspaceTarget(
        boundary,
        input.path,
        "file",
      );
      return this.inspectTarget(written, guard);
    });
  }

  async renameFile(input: {
    path: string;
    name: string;
    revision: string;
  }): Promise<WorkspaceFile> {
    return this.mutate(async () => {
      const guard = createOperationGuard();
      const boundary = await this.boundary();
      const source = await resolveWorkspaceTarget(boundary, input.path, "file");
      assertRevision(source.stat, input.revision);
      const name = parseWorkspaceBasename(input.name);
      const parentPath = source.path.includes("/")
        ? source.path.slice(0, source.path.lastIndexOf("/"))
        : "";
      const destinationPath = parentPath ? `${parentPath}/${name}` : name;
      if (destinationPath === source.path) {
        throw new WorkspaceError(400, "invalid_path");
      }
      const destination = await resolveWorkspaceParent(
        boundary,
        destinationPath,
      );
      try {
        await lstat(destination.absolute);
        throw new WorkspaceError(409, "exists");
      } catch (error) {
        if (error instanceof WorkspaceError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          return mapWorkspaceFsError(error);
        }
      }

      const latest = await resolveWorkspaceTarget(boundary, input.path, "file");
      assertRevision(latest.stat, input.revision);
      guard();
      try {
        await link(latest.absolute, destination.absolute);
        try {
          await unlink(latest.absolute);
        } catch (error) {
          await unlink(destination.absolute).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        return mapWorkspaceFsError(error);
      }
      const renamed = await resolveWorkspaceTarget(
        boundary,
        destinationPath,
        "file",
      );
      return this.inspectTarget(renamed, guard);
    });
  }

  async deleteFile(input: { path: string; revision: string }): Promise<void> {
    return this.mutate(async () => {
      const guard = createOperationGuard();
      const boundary = await this.boundary();
      const current = await resolveWorkspaceTarget(
        boundary,
        input.path,
        "file",
      );
      assertRevision(current.stat, input.revision);
      const latest = await resolveWorkspaceTarget(boundary, input.path, "file");
      assertRevision(latest.stat, input.revision);
      guard();
      try {
        await unlink(latest.absolute);
      } catch (error) {
        return mapWorkspaceFsError(error);
      }
    });
  }

  async downloadFile(
    path: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceDownload> {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Cancelled", "AbortError");
    }
    const boundary = await this.boundary();
    const target = await resolveWorkspaceTarget(boundary, path, "file");
    const handle = await openNoFollow(target.absolute);
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile()) throw new WorkspaceError(415, "unsupported");
      if (revisionFromStat(stat) !== revisionFromStat(target.stat)) {
        throw new WorkspaceError(404, "not_found");
      }
      if (stat.size > BigInt(MAX_WORKSPACE_DOWNLOAD_BYTES)) {
        throw new WorkspaceError(413, "too_large");
      }
      if (stat.size === 0n) {
        await handle.close();
        return {
          name: basename(target.path),
          size: 0,
          stream: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
        };
      }
      const nodeStream = handle.createReadStream({
        autoClose: true,
        start: 0,
        end: Number(stat.size) - 1,
      });
      if (signal) {
        const abort = () => nodeStream.destroy();
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
        nodeStream.once("close", () =>
          signal.removeEventListener("abort", abort),
        );
      }
      return {
        name: basename(target.path),
        size: Number(stat.size),
        stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
      };
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }
}
