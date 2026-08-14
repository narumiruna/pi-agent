import { opendir } from "node:fs/promises";
import type { WorkspaceMatch } from "../../shared/contracts.js";
import { WorkspaceError } from "./errors.js";
import {
  createOperationGuard,
  createWorkspaceBoundary,
  isHiddenWorkspaceEntry,
  resolveWorkspaceTarget,
  type WorkspaceTarget,
} from "./policy.js";

const MAX_SCANNED_ENTRIES = 10_000;
const MAX_RESULTS = 50;

function fuzzyScore(path: string, rawQuery: string): number | undefined {
  const value = path.toLowerCase();
  const query = rawQuery.toLowerCase();
  if (value === query) return 0;
  if (value.startsWith(query)) return 1;
  const segment = value.lastIndexOf(`/${query}`);
  if (segment >= 0) return 2 + segment / 10_000;
  const included = value.indexOf(query);
  if (included >= 0) return 3 + included / 10_000;
  let queryIndex = 0;
  let gap = 0;
  let previous = -1;
  for (
    let index = 0;
    index < value.length && queryIndex < query.length;
    index++
  ) {
    if (value[index] !== query[queryIndex]) continue;
    if (previous >= 0) gap += index - previous - 1;
    previous = index;
    queryIndex += 1;
  }
  return queryIndex === query.length ? 4 + gap / 1_000 : undefined;
}

export async function searchWorkspace(
  workspace: string,
  rawQuery: string,
  options: {
    excludePaths?: readonly string[];
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<WorkspaceMatch[]> {
  const query = rawQuery.trim().replaceAll("\\", "/");
  if (query.length < 1 || query.length > 200 || query.includes("\0")) return [];
  const boundary = await createWorkspaceBoundary(
    workspace,
    options.excludePaths ?? [],
  );
  const guard = createOperationGuard(options.signal);
  const requestedLimit = options.limit ?? 20;
  const limit = Math.max(1, Math.min(MAX_RESULTS, requestedLimit));
  const matches: Array<WorkspaceMatch & { score: number }> = [];
  const directories = [""];
  let scanned = 0;

  while (directories.length > 0 && scanned < MAX_SCANNED_ENTRIES) {
    guard();
    const path = directories.shift() as string;
    let directory: WorkspaceTarget;
    try {
      directory = await resolveWorkspaceTarget(boundary, path, "directory");
    } catch (error) {
      if (path && error instanceof WorkspaceError && error.status === 404) {
        continue;
      }
      throw error;
    }
    let handle: Awaited<ReturnType<typeof opendir>>;
    try {
      handle = await opendir(directory.absolute);
    } catch {
      continue;
    }
    for await (const entry of handle) {
      guard();
      scanned += 1;
      if (scanned > MAX_SCANNED_ENTRIES) break;
      if (
        entry.isSymbolicLink() ||
        isHiddenWorkspaceEntry(entry.name, entry.isDirectory())
      ) {
        continue;
      }
      const childPath = path ? `${path}/${entry.name}` : entry.name;
      let child: WorkspaceTarget;
      try {
        child = await resolveWorkspaceTarget(boundary, childPath, "either");
      } catch (error) {
        if (error instanceof WorkspaceError && error.status === 404) continue;
        throw error;
      }
      const directory = child.stat.isDirectory();
      if (directory) directories.push(childPath);
      else if (!child.stat.isFile()) continue;
      const score = fuzzyScore(childPath, query);
      if (score !== undefined) {
        matches.push({ path: childPath, directory, score });
      }
    }
  }

  return matches
    .sort(
      (left, right) =>
        Number(right.directory) - Number(left.directory) ||
        left.score - right.score ||
        left.path.localeCompare(right.path),
    )
    .slice(0, limit)
    .map(({ path, directory }) => ({ path, directory }));
}
