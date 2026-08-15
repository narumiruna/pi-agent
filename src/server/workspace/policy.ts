import type { BigIntStats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { mapWorkspaceFsError, WorkspaceError } from "./errors.js";

export const MAX_WORKSPACE_PATH_LENGTH = 1_024;
export const WORKSPACE_OPERATION_TIMEOUT_MS = 2_000;

const EXCLUDED_DIRECTORIES = new Set([
  ".agents",
  ".git",
  ".hg",
  ".local",
  ".pi",
  ".ssh",
  ".svn",
  "dist",
  "node_modules",
]);

const SENSITIVE_FILE_NAMES = new Set([
  ".envrc",
  ".git-credentials",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "auth.json",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secrets.json",
]);

const SENSITIVE_FILE_SUFFIXES = [".key", ".p12", ".p8", ".pem", ".pfx"];

export interface WorkspaceBoundary {
  root: string;
  excludedPaths: string[];
}

export interface WorkspaceTarget {
  absolute: string;
  path: string;
  stat: BigIntStats;
}

export interface WorkspaceParent {
  absolute: string;
  parent: WorkspaceTarget;
  path: string;
}

export function isCredentialLikeName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === ".env" ||
    lower.startsWith(".env.") ||
    (lower.startsWith(".pi-agent-") && lower.endsWith(".tmp")) ||
    SENSITIVE_FILE_NAMES.has(lower) ||
    SENSITIVE_FILE_SUFFIXES.some((suffix) => lower.endsWith(suffix))
  );
}

export function isHiddenWorkspaceEntry(
  name: string,
  directory: boolean,
): boolean {
  return (
    isCredentialLikeName(name) ||
    (directory && EXCLUDED_DIRECTORIES.has(name.toLowerCase()))
  );
}

export function isPathContained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

export function isExcludedWorkspacePath(
  boundary: WorkspaceBoundary,
  candidate: string,
): boolean {
  return boundary.excludedPaths.some((excluded) =>
    isPathContained(excluded, candidate),
  );
}

export function parseWorkspacePath(rawPath: string): string {
  if (
    rawPath.length > MAX_WORKSPACE_PATH_LENGTH ||
    rawPath.includes("\0") ||
    rawPath.includes("\\") ||
    rawPath.startsWith("/") ||
    /^[a-zA-Z]:\//.test(rawPath)
  ) {
    throw new WorkspaceError(400, "invalid_path");
  }
  if (rawPath === "") return "";
  const segments = rawPath.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        Buffer.byteLength(segment) > 255,
    )
  ) {
    throw new WorkspaceError(400, "invalid_path");
  }
  return segments.join("/");
}

export function parseWorkspaceBasename(rawName: string): string {
  const hasControlCharacter = [...rawName].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
  if (
    !rawName ||
    rawName === "." ||
    rawName === ".." ||
    rawName.includes("/") ||
    rawName.includes("\\") ||
    hasControlCharacter ||
    Buffer.byteLength(rawName) > 255 ||
    isCredentialLikeName(rawName) ||
    EXCLUDED_DIRECTORIES.has(rawName.toLowerCase())
  ) {
    throw new WorkspaceError(400, "invalid_path");
  }
  return rawName;
}

export interface OperationGuard {
  (): void;
  run<T>(operation: () => Promise<T>): Promise<T>;
  wait<T>(operation: Promise<T>): Promise<T>;
}

function cancellationReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException("Cancelled", "AbortError");
}

export function createOperationGuard(
  signal?: AbortSignal,
  timeoutMs = WORKSPACE_OPERATION_TIMEOUT_MS,
): OperationGuard {
  const deadline = performance.now() + Math.max(0, timeoutMs);
  const guard = (() => {
    if (signal?.aborted) throw cancellationReason(signal);
    if (performance.now() >= deadline) {
      throw new WorkspaceError(400, "cancelled");
    }
  }) as OperationGuard;

  guard.wait = <T>(operation: Promise<T>) =>
    new Promise<T>((resolvePromise, rejectPromise) => {
      let settled = false;
      let abortListener: (() => void) | undefined;
      const timeout = setTimeout(
        () => rejectOnce(new WorkspaceError(400, "cancelled")),
        Math.max(0, deadline - performance.now()),
      );
      timeout.unref();

      const cleanup = () => {
        clearTimeout(timeout);
        if (signal && abortListener) {
          signal.removeEventListener("abort", abortListener);
        }
      };
      const resolveOnce = (value: T) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolvePromise(value);
      };
      function rejectOnce(error: unknown) {
        if (settled) return;
        settled = true;
        cleanup();
        rejectPromise(error);
      }

      if (signal) {
        abortListener = () => rejectOnce(cancellationReason(signal));
        signal.addEventListener("abort", abortListener, { once: true });
        if (signal.aborted) abortListener();
      }
      operation.then(resolveOnce, rejectOnce);
    });
  guard.run = <T>(operation: () => Promise<T>) => {
    guard();
    return guard.wait(
      Promise.resolve().then(() => {
        guard();
        return operation();
      }),
    );
  };

  return guard;
}

export async function createWorkspaceBoundary(
  workspace: string,
  excludePaths: readonly string[] = [],
  guard = createOperationGuard(),
): Promise<WorkspaceBoundary> {
  let root: string;
  try {
    root = await guard.run(() => realpath(resolve(workspace)));
  } catch (error) {
    return mapWorkspaceFsError(error);
  }
  const excludedPaths = await Promise.all(
    excludePaths.map((path) => {
      const resolved = resolve(path);
      return guard.run(() => realpath(resolved).catch(() => resolved));
    }),
  );
  return { root, excludedPaths };
}

function assertAllowedAbsolute(
  boundary: WorkspaceBoundary,
  absolute: string,
): void {
  if (
    !isPathContained(boundary.root, absolute) ||
    isExcludedWorkspacePath(boundary, absolute)
  ) {
    throw new WorkspaceError(404, "not_found");
  }
}

async function readStat(
  path: string,
  guard: OperationGuard,
): Promise<BigIntStats> {
  try {
    return await guard.run(() => lstat(path, { bigint: true }));
  } catch (error) {
    return mapWorkspaceFsError(error);
  }
}

export async function resolveWorkspaceTarget(
  boundary: WorkspaceBoundary,
  rawPath: string,
  expected: "directory" | "file" | "either" = "either",
  guard = createOperationGuard(),
): Promise<WorkspaceTarget> {
  const path = parseWorkspacePath(rawPath);
  if (path === "") {
    if (expected === "file") throw new WorkspaceError(404, "not_found");
    const stat = await readStat(boundary.root, guard);
    if (!stat.isDirectory()) throw new WorkspaceError(404, "not_found");
    return { absolute: boundary.root, path, stat };
  }

  let absolute = boundary.root;
  let stat: BigIntStats | undefined;
  const segments = path.split("/");
  for (const [index, segment] of segments.entries()) {
    absolute = join(absolute, segment);
    assertAllowedAbsolute(boundary, absolute);
    stat = await readStat(absolute, guard);
    if (stat.isSymbolicLink()) throw new WorkspaceError(404, "not_found");
    const final = index === segments.length - 1;
    if (isHiddenWorkspaceEntry(segment, stat.isDirectory())) {
      throw new WorkspaceError(404, "not_found");
    }
    if (!final && !stat.isDirectory()) {
      throw new WorkspaceError(404, "not_found");
    }
  }

  let canonical: string;
  try {
    canonical = await guard.run(() => realpath(absolute));
  } catch (error) {
    return mapWorkspaceFsError(error);
  }
  assertAllowedAbsolute(boundary, canonical);
  if (!stat) throw new WorkspaceError(404, "not_found");
  if (expected === "file" && !stat.isFile()) {
    throw new WorkspaceError(415, "unsupported");
  }
  if (expected === "directory" && !stat.isDirectory()) {
    throw new WorkspaceError(404, "not_found");
  }
  return { absolute: canonical, path, stat };
}

export async function resolveWorkspaceParent(
  boundary: WorkspaceBoundary,
  rawPath: string,
  guard = createOperationGuard(),
): Promise<WorkspaceParent> {
  const path = parseWorkspacePath(rawPath);
  if (!path) throw new WorkspaceError(400, "invalid_path");
  const segments = path.split("/");
  const name = parseWorkspaceBasename(segments.pop() as string);
  const parentPath = segments.join("/");
  const parent = await resolveWorkspaceTarget(
    boundary,
    parentPath,
    "directory",
    guard,
  );
  const absolute = join(parent.absolute, name);
  assertAllowedAbsolute(boundary, absolute);
  return { absolute, parent, path };
}
