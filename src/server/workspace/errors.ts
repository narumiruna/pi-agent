export type WorkspaceErrorReason =
  | "binary"
  | "cancelled"
  | "exists"
  | "invalid_path"
  | "not_found"
  | "read_only"
  | "stale"
  | "too_large"
  | "unsupported";

export type WorkspaceErrorStatus = 400 | 403 | 404 | 409 | 413 | 415;

export class WorkspaceError extends Error {
  constructor(
    readonly status: WorkspaceErrorStatus,
    readonly reason: WorkspaceErrorReason,
  ) {
    super("Workspace operation failed");
    this.name = "WorkspaceError";
  }
}

export function mapWorkspaceFsError(error: unknown): never {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
    throw new WorkspaceError(404, "not_found");
  }
  if (code === "EEXIST") throw new WorkspaceError(409, "exists");
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    throw new WorkspaceError(403, "read_only");
  }
  if (code === "EFBIG") throw new WorkspaceError(413, "too_large");
  throw error;
}
