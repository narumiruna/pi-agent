import { realpathSync } from "node:fs";
import { Worker } from "node:worker_threads";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

const REGEX_SEARCH_TIMEOUT_MS = 100;
const REGEX_WORKER_LIMIT = 2;
const SEARCH_CORPUS_LIMIT = 5_000_000;
const TOKEN_SEARCH_WORK_LIMIT = 5_000_000;
let activeRegexWorkers = 0;
const REGEX_WORKER_SOURCE = `
  const { parentPort, workerData } = require("node:worker_threads");
  try {
    const regex = new RegExp(workerData.pattern, "i");
    parentPort.postMessage(workerData.texts.map((text) => text.search(regex)));
  } catch {
    parentPort.postMessage(null);
  }
`;

export type ConversationNameFilter = "all" | "named";
export type ConversationSort = "recent" | "relevance" | "threaded";

export interface ConversationListOptions {
  query?: string;
  nameFilter?: ConversationNameFilter;
  sort?: ConversationSort;
}

export interface ConversationDiscoveryRecord {
  id: string;
  name?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  active: boolean;
  cwd: string;
  allMessagesText: string;
  path?: string;
  parentSessionPath?: string;
}

export interface ParsedConversationSearch {
  mode: "regex" | "tokens";
  tokens: Array<{ kind: "fuzzy" | "phrase"; value: string }>;
  regex: RegExp | null;
  error?: string;
}

interface MatchResult {
  matches: boolean;
  score: number;
}

function normalizeWhitespaceLower(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function searchText(record: ConversationDiscoveryRecord): string {
  return `${record.id} ${record.name ?? ""} ${record.allMessagesText} ${record.cwd}`;
}

function searchableTextLength(record: ConversationDiscoveryRecord): number {
  return (
    record.id.length +
    (record.name?.length ?? 0) +
    record.allMessagesText.length +
    record.cwd.length +
    3
  );
}

function aggregateSearchWithinBudget(
  records: ConversationDiscoveryRecord[],
  multiplier: number,
  limit: number,
): boolean {
  let remaining = limit;
  for (const record of records) {
    remaining -= searchableTextLength(record) * multiplier;
    if (remaining < 0) return false;
  }
  return true;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        part?.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
}

export function conversationMessagesText(
  messages: readonly AgentMessage[],
): string {
  return messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message) => messageText(message.content))
    .filter(Boolean)
    .join(" ");
}

export function hasConversationName(
  record: ConversationDiscoveryRecord,
): boolean {
  return Boolean(record.name?.trim());
}

export function parseConversationSearch(
  query: string,
): ParsedConversationSearch {
  const trimmed = query.trim();
  if (!trimmed) return { mode: "tokens", tokens: [], regex: null };
  if (trimmed.startsWith("re:")) {
    const pattern = trimmed.slice(3).trim();
    if (!pattern)
      return {
        mode: "regex",
        tokens: [],
        regex: null,
        error: "Empty regex",
      };
    try {
      return {
        mode: "regex",
        tokens: [],
        regex: new RegExp(pattern, "i"),
      };
    } catch (error) {
      return {
        mode: "regex",
        tokens: [],
        regex: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const tokens: ParsedConversationSearch["tokens"] = [];
  let buffer = "";
  let inQuote = false;
  const flush = (kind: "fuzzy" | "phrase") => {
    const value = buffer.trim();
    buffer = "";
    if (value) tokens.push({ kind, value });
  };
  for (const character of trimmed) {
    if (character === '"') {
      if (inQuote) {
        flush("phrase");
        inQuote = false;
      } else {
        flush("fuzzy");
        inQuote = true;
      }
      continue;
    }
    if (!inQuote && /\s/.test(character)) {
      flush("fuzzy");
      continue;
    }
    buffer += character;
  }
  if (inQuote) {
    return {
      mode: "tokens",
      tokens: trimmed
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => ({ kind: "fuzzy" as const, value })),
      regex: null,
    };
  }
  flush("fuzzy");
  return { mode: "tokens", tokens, regex: null };
}

/** Matches the installed Pi TUI fuzzy scorer; lower scores are better. */
export function fuzzyConversationMatch(
  query: string,
  text: string,
): MatchResult {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  const matchQuery = (normalizedQuery: string): MatchResult => {
    if (!normalizedQuery) return { matches: true, score: 0 };
    if (normalizedQuery.length > textLower.length)
      return { matches: false, score: 0 };
    let queryIndex = 0;
    let score = 0;
    let lastMatchIndex = -1;
    let consecutiveMatches = 0;
    for (
      let index = 0;
      index < textLower.length && queryIndex < normalizedQuery.length;
      index++
    ) {
      if (textLower[index] !== normalizedQuery[queryIndex]) continue;
      const wordBoundary =
        index === 0 || /[\s\-_./:]/.test(textLower[index - 1] ?? "");
      if (lastMatchIndex === index - 1) {
        consecutiveMatches++;
        score -= consecutiveMatches * 5;
      } else {
        consecutiveMatches = 0;
        if (lastMatchIndex >= 0) score += (index - lastMatchIndex - 1) * 2;
      }
      if (wordBoundary) score -= 10;
      score += index * 0.1;
      lastMatchIndex = index;
      queryIndex++;
    }
    if (queryIndex < normalizedQuery.length)
      return { matches: false, score: 0 };
    if (normalizedQuery === textLower) score -= 100;
    return { matches: true, score };
  };

  const primary = matchQuery(queryLower);
  if (primary.matches) return primary;
  const alphaNumeric = queryLower.match(
    /^(?<letters>[a-z]+)(?<digits>[0-9]+)$/,
  );
  const numericAlpha = queryLower.match(
    /^(?<digits>[0-9]+)(?<letters>[a-z]+)$/,
  );
  const swapped = alphaNumeric
    ? `${alphaNumeric.groups?.digits ?? ""}${alphaNumeric.groups?.letters ?? ""}`
    : numericAlpha
      ? `${numericAlpha.groups?.letters ?? ""}${numericAlpha.groups?.digits ?? ""}`
      : "";
  if (!swapped) return primary;
  const swappedMatch = matchQuery(swapped);
  return swappedMatch.matches
    ? { matches: true, score: swappedMatch.score + 5 }
    : primary;
}

function matchConversationTokens(
  record: ConversationDiscoveryRecord,
  tokens: ParsedConversationSearch["tokens"],
): MatchResult {
  const text = searchText(record);
  if (tokens.length === 0) return { matches: true, score: 0 };
  let score = 0;
  let normalizedText: string | undefined;
  for (const token of tokens) {
    if (token.kind === "phrase") {
      normalizedText ??= normalizeWhitespaceLower(text);
      const phrase = normalizeWhitespaceLower(token.value);
      if (!phrase) continue;
      const index = normalizedText.indexOf(phrase);
      if (index < 0) return { matches: false, score: 0 };
      score += index * 0.1;
      continue;
    }
    const match = fuzzyConversationMatch(token.value, text);
    if (!match.matches) return { matches: false, score: 0 };
    score += match.score;
  }
  return { matches: true, score };
}

function regexSearchScores(
  pattern: string,
  records: ConversationDiscoveryRecord[],
): Promise<number[] | undefined> {
  if (
    !aggregateSearchWithinBudget(records, 1, SEARCH_CORPUS_LIMIT) ||
    activeRegexWorkers >= REGEX_WORKER_LIMIT
  )
    return Promise.resolve(undefined);
  activeRegexWorkers++;
  return new Promise((resolve) => {
    let worker: Worker | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (scores?: number[]) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (worker) void worker.terminate().catch(() => undefined);
      activeRegexWorkers--;
      resolve(scores);
    };
    try {
      const texts = records.map(searchText);
      worker = new Worker(REGEX_WORKER_SOURCE, {
        eval: true,
        workerData: { pattern, texts },
      });
      timeout = setTimeout(() => finish(), REGEX_SEARCH_TIMEOUT_MS);
      worker.once("message", (value: unknown) => {
        if (
          Array.isArray(value) &&
          value.length === texts.length &&
          value.every(
            (score) =>
              typeof score === "number" &&
              Number.isInteger(score) &&
              score >= -1,
          )
        ) {
          finish(value);
        } else {
          finish();
        }
      });
      worker.once("error", () => finish());
      worker.once("exit", () => finish());
    } catch {
      finish();
    }
  });
}

function modifiedDescending(
  left: ConversationDiscoveryRecord,
  right: ConversationDiscoveryRecord,
): number {
  const difference = right.modified.getTime() - left.modified.getTime();
  if (difference !== 0) return difference;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

interface ThreadNode {
  key: string;
  record: ConversationDiscoveryRecord;
  children: ThreadNode[];
  latestActivity: number;
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function threadedRecords(
  records: ConversationDiscoveryRecord[],
): ConversationDiscoveryRecord[] {
  const nodes = records.map<ThreadNode>((record, index) => ({
    key: record.path
      ? canonicalPath(record.path)
      : `active:${record.id}:${index}`,
    record,
    children: [],
    latestActivity: record.modified.getTime(),
  }));
  const byPath = new Map(
    nodes
      .filter((node) => node.record.path)
      .map((node) => [canonicalPath(node.record.path as string), node]),
  );
  const intendedParent = new Map<string, ThreadNode>();
  for (const node of nodes) {
    const parentPath = node.record.parentSessionPath;
    const parent = parentPath
      ? byPath.get(canonicalPath(parentPath))
      : undefined;
    if (parent && parent !== node) intendedParent.set(node.key, parent);
  }
  const createsCycle = (node: ThreadNode, parent: ThreadNode) => {
    const visited = new Set([node.key]);
    let current: ThreadNode | undefined = parent;
    while (current) {
      if (visited.has(current.key)) return true;
      visited.add(current.key);
      current = intendedParent.get(current.key);
    }
    return false;
  };
  const roots: ThreadNode[] = [];
  for (const node of nodes) {
    const parent = intendedParent.get(node.key);
    if (!parent || createsCycle(node, parent)) roots.push(node);
    else parent.children.push(node);
  }
  const updateLatest = (node: ThreadNode): number => {
    for (const child of node.children)
      node.latestActivity = Math.max(node.latestActivity, updateLatest(child));
    return node.latestActivity;
  };
  const sortNodes = (items: ThreadNode[]) => {
    items.sort((left, right) => {
      const difference = right.latestActivity - left.latestActivity;
      if (difference !== 0) return difference;
      return left.record.id < right.record.id
        ? -1
        : left.record.id > right.record.id
          ? 1
          : 0;
    });
    for (const node of items) sortNodes(node.children);
  };
  for (const root of roots) updateLatest(root);
  sortNodes(roots);
  const result: ConversationDiscoveryRecord[] = [];
  const visited = new Set<string>();
  const append = (node: ThreadNode) => {
    if (visited.has(node.key)) return;
    visited.add(node.key);
    result.push(node.record);
    for (const child of node.children) append(child);
  };
  for (const root of roots) append(root);
  for (const node of nodes) append(node);
  return result;
}

export async function discoverConversations(
  records: ConversationDiscoveryRecord[],
  options: ConversationListOptions = {},
): Promise<ConversationDiscoveryRecord[]> {
  const recent = [...records].sort(modifiedDescending);
  const nameFiltered =
    (options.nameFilter ?? "all") === "named"
      ? recent.filter(hasConversationName)
      : recent;
  const query = options.query?.trim() ?? "";
  if (!query)
    return (options.sort ?? "threaded") === "threaded"
      ? threadedRecords(nameFiltered)
      : nameFiltered;
  const parsed = parseConversationSearch(query);
  if (parsed.error) return [];
  if (
    !parsed.regex &&
    !aggregateSearchWithinBudget(
      nameFiltered,
      parsed.tokens.length,
      TOKEN_SEARCH_WORK_LIMIT,
    )
  )
    return [];
  const scored = parsed.regex
    ? ((await regexSearchScores(parsed.regex.source, nameFiltered))?.flatMap(
        (score, index) => {
          const record = nameFiltered[index];
          return score < 0 || !record ? [] : [{ record, score: score * 0.1 }];
        },
      ) ?? [])
    : nameFiltered.flatMap((record) => {
        const match = matchConversationTokens(record, parsed.tokens);
        return match.matches ? [{ record, score: match.score }] : [];
      });
  if (options.sort === "recent") return scored.map(({ record }) => record);
  // Pi 0.84.1 builds threads only for an empty query. Searched Threaded and
  // Fuzzy modes both use relevance, while Recent retains timestamp order.
  scored.sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    return modifiedDescending(left.record, right.record);
  });
  return scored.map(({ record }) => record);
}
