import { opendir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".local",
  ".pi",
  ".ssh",
  ".svn",
  "dist",
  "node_modules",
]);
const MAX_SCANNED_ENTRIES = 10_000;
const MAX_RESULTS = 50;

export interface WorkspaceMatch {
  path: string;
  directory: boolean;
}

function isSensitiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === ".env" ||
    lower.startsWith(".env.") ||
    lower === "auth.json" ||
    lower === "credentials.json" ||
    lower === "id_rsa" ||
    lower === "id_ed25519" ||
    lower.endsWith(".pem") ||
    lower.endsWith(".key")
  );
}

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
  const root = await realpath(resolve(workspace));
  const excludedPaths = await Promise.all(
    (options.excludePaths ?? []).map(async (path) => {
      const resolved = resolve(path);
      return realpath(resolved).catch(() => resolved);
    }),
  );
  const isExcluded = (path: string) =>
    excludedPaths.some(
      (excluded) => path === excluded || path.startsWith(`${excluded}${sep}`),
    );
  const requestedLimit = options.limit ?? 20;
  const limit = Math.max(1, Math.min(MAX_RESULTS, requestedLimit));
  const matches: Array<WorkspaceMatch & { score: number }> = [];
  const directories = [root];
  let scanned = 0;

  while (directories.length > 0 && scanned < MAX_SCANNED_ENTRIES) {
    if (options.signal?.aborted) throw options.signal.reason;
    const directory = directories.shift() as string;
    let handle: Awaited<ReturnType<typeof opendir>>;
    try {
      handle = await opendir(directory);
    } catch {
      continue;
    }
    for await (const entry of handle) {
      if (options.signal?.aborted) throw options.signal.reason;
      scanned += 1;
      if (scanned > MAX_SCANNED_ENTRIES) break;
      if (
        entry.isSymbolicLink() ||
        isSensitiveName(entry.name) ||
        (entry.isDirectory() &&
          EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase()))
      )
        continue;
      const absolute = join(directory, entry.name);
      if (isExcluded(absolute)) continue;
      const path = relative(root, absolute).split(sep).join("/");
      if (!path || path.startsWith("../") || path === "..") continue;
      if (entry.isDirectory()) directories.push(absolute);
      else if (!entry.isFile()) continue;
      const score = fuzzyScore(path, query);
      if (score !== undefined)
        matches.push({ path, directory: entry.isDirectory(), score });
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
