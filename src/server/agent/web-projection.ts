import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { SessionTreeNode } from "@earendil-works/pi-coding-agent";
import type { LiveToolState, SessionTreeItem } from "../../shared/contracts.js";
import { sanitizeExtensionText } from "../interactions/web-state.js";

const MAX_EVENT_JSON = 100_000;
const MAX_TOOL_TEXT = 50_000;
const MAX_TREE_ITEMS = 2_000;

function stringifyBounded(value: unknown, maxLength = MAX_EVENT_JSON): unknown {
  const seen = new WeakSet<object>();
  let json: string;
  try {
    json = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "bigint") return String(item);
      if (typeof item === "function" || typeof item === "symbol")
        return undefined;
      if (typeof item === "string")
        return sanitizeExtensionText(item, MAX_TOOL_TEXT);
      if (item && typeof item === "object") {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }
      return item;
    });
  } catch {
    return "[Unserializable result]";
  }
  if (json === undefined) return undefined;
  if (json.length > maxLength)
    return {
      truncated: true,
      preview: sanitizeExtensionText(json.slice(0, maxLength), maxLength),
    };
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return "[Unserializable result]";
  }
}

function resultText(result: AgentToolResult<unknown>): string {
  return sanitizeExtensionText(
    (result.content ?? [])
      .filter(
        (part): part is { type: "text"; text: string } =>
          part?.type === "text" && typeof part.text === "string",
      )
      .map((part) => part.text)
      .join(""),
    MAX_TOOL_TEXT,
  );
}

function resultDiff(result: AgentToolResult<unknown>): string | undefined {
  if (!result.details || typeof result.details !== "object") return undefined;
  const details = result.details as Record<string, unknown>;
  const diff =
    typeof details.patch === "string"
      ? details.patch
      : typeof details.diff === "string"
        ? details.diff
        : undefined;
  return diff ? sanitizeExtensionText(diff, MAX_TOOL_TEXT) : undefined;
}

export function projectLiveTool(
  sessionId: string,
  event: {
    toolCallId: string;
    toolName: string;
    args?: unknown;
    result?: AgentToolResult<unknown>;
    partialResult?: AgentToolResult<unknown>;
    isError?: boolean;
  },
  startedAt: number,
): LiveToolState {
  const result = event.result ?? event.partialResult;
  const output = result ? resultText(result) : undefined;
  const diff = result ? resultDiff(result) : undefined;
  const updatedAt = Date.now();
  return {
    sessionId,
    id: event.toolCallId,
    name: sanitizeExtensionText(event.toolName, 200),
    status: event.result ? (event.isError ? "error" : "done") : "running",
    ...(event.args !== undefined
      ? { args: stringifyBounded(event.args, 25_000) }
      : {}),
    ...(result ? { result: stringifyBounded(result) } : {}),
    ...(output ? { output } : {}),
    ...(diff ? { diff } : {}),
    startedAt,
    updatedAt,
    durationMs: Math.max(0, updatedAt - startedAt),
  };
}

function entryPreview(node: SessionTreeNode): string {
  const { entry } = node;
  if (entry.type === "message") {
    const message = entry.message;
    if (message.role === "assistant" || message.role === "user") {
      const text = Array.isArray(message.content)
        ? message.content
            .filter(
              (part): part is { type: "text"; text: string } =>
                part?.type === "text" && typeof part.text === "string",
            )
            .map((part) => part.text)
            .join("")
        : typeof message.content === "string"
          ? message.content
          : "";
      return sanitizeExtensionText(text, 240).replaceAll("\n", " ");
    }
    if (message.role === "toolResult") return message.toolName;
  }
  if (entry.type === "compaction" || entry.type === "branch_summary")
    return sanitizeExtensionText(entry.summary, 240).replaceAll("\n", " ");
  if (entry.type === "custom") return entry.customType;
  if (entry.type === "custom_message") return entry.customType;
  if (entry.type === "model_change")
    return `${entry.provider}/${entry.modelId}`;
  if (entry.type === "thinking_level_change") return entry.thinkingLevel;
  return entry.type;
}

export function projectSessionTree(tree: SessionTreeNode[]): {
  tree: SessionTreeItem[];
  truncated: boolean;
} {
  let count = 0;
  let truncated = false;
  const visit = (node: SessionTreeNode): SessionTreeItem | undefined => {
    if (count >= MAX_TREE_ITEMS) {
      truncated = true;
      return undefined;
    }
    count += 1;
    return {
      id: node.entry.id,
      parentId: node.entry.parentId,
      type: node.entry.type,
      timestamp: node.entry.timestamp,
      ...(node.label ? { label: sanitizeExtensionText(node.label, 120) } : {}),
      preview: entryPreview(node),
      canForkBefore:
        node.entry.type === "message" && node.entry.message.role === "user",
      children: node.children.flatMap((child) => {
        const projected = visit(child);
        return projected ? [projected] : [];
      }),
    };
  };
  return {
    tree: tree.flatMap((node) => {
      const projected = visit(node);
      return projected ? [projected] : [];
    }),
    truncated,
  };
}

export function boundedQueue(messages: readonly string[]): string[] {
  return messages
    .slice(0, 100)
    .map((message) => sanitizeExtensionText(message, 4_000));
}
