import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolCall } from "@earendil-works/pi-ai";
import {
  type ChatImage,
  normalizeChatImageMimeType,
} from "../../shared/contracts.js";
import { sanitizeExtensionText } from "../interactions/web-state.js";

export interface TranscriptToolResult {
  text: string;
  diff?: string;
  images?: TranscriptImage[];
  isError: boolean;
}

export interface TranscriptTool {
  id: string;
  name: string;
  arguments: unknown;
  result?: TranscriptToolResult;
}

export interface TranscriptImage extends ChatImage {
  id: string;
}

export interface TranscriptMessage {
  id: string;
  role: "assistant" | "bash" | "custom" | "status" | "tool" | "user";
  text: string;
  timestamp: number;
  label?: string;
  thinking?: string;
  images?: TranscriptImage[];
  tools?: TranscriptTool[];
  toolName?: string;
  isError?: boolean;
}

function imagesFromContent(
  content: unknown,
  timestamp: number,
): TranscriptImage[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part, index) => {
    if (
      part?.type !== "image" ||
      typeof part.data !== "string" ||
      typeof part.mimeType !== "string"
    )
      return [];
    const mimeType = normalizeChatImageMimeType(part.mimeType);
    return mimeType
      ? [
          {
            id: `${timestamp}-image-${index}`,
            type: "image" as const,
            data: part.data,
            mimeType,
          },
        ]
      : [];
  });
}

function textFromContent(content: unknown): string {
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

function thinkingFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "thinking"; thinking: string } =>
        part?.type === "thinking" && typeof part.thinking === "string",
    )
    .map((part) => part.thinking)
    .join("");
}

function diffFromDetails(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const record = details as Record<string, unknown>;
  const value =
    typeof record.patch === "string"
      ? record.patch
      : typeof record.diff === "string"
        ? record.diff
        : undefined;
  return value ? sanitizeExtensionText(value, 100_000) : undefined;
}

export function projectTranscript(
  messages: AgentMessage[],
): TranscriptMessage[] {
  const projected: TranscriptMessage[] = [];
  const tools = new Map<string, TranscriptTool>();

  for (const [index, message] of messages.entries()) {
    const id = `${message.timestamp}-${index}`;
    if (message.role === "user") {
      const images = imagesFromContent(message.content, message.timestamp);
      projected.push({
        id,
        role: "user",
        text: textFromContent(message.content),
        timestamp: message.timestamp,
        ...(images.length > 0 ? { images } : {}),
      });
      continue;
    }
    if (message.role === "assistant") {
      const messageTools = Array.isArray(message.content)
        ? message.content
            .filter((part): part is ToolCall => part.type === "toolCall")
            .map((part) => {
              const tool = {
                id: part.id,
                name: part.name,
                arguments: part.arguments,
              };
              tools.set(part.id, tool);
              return tool;
            })
        : [];
      const thinking = thinkingFromContent(message.content);
      const images = imagesFromContent(message.content, message.timestamp);
      projected.push({
        id,
        role: "assistant",
        text: textFromContent(message.content),
        timestamp: message.timestamp,
        ...(thinking ? { thinking } : {}),
        ...(images.length > 0 ? { images } : {}),
        ...(messageTools.length > 0 ? { tools: messageTools } : {}),
      });
      continue;
    }
    if (message.role === "toolResult") {
      const diff = diffFromDetails(message.details);
      const images = imagesFromContent(message.content, message.timestamp);
      const result: TranscriptToolResult = {
        text: sanitizeExtensionText(textFromContent(message.content), 100_000),
        ...(diff ? { diff } : {}),
        ...(images.length > 0 ? { images } : {}),
        isError: message.isError,
      };
      const tool = tools.get(message.toolCallId);
      if (tool) tool.result = result;
      else
        projected.push({
          id,
          role: "tool",
          text: result.text,
          timestamp: message.timestamp,
          toolName: message.toolName,
          isError: message.isError,
          ...(result.images ? { images: result.images } : {}),
        });
      continue;
    }
    if (message.role === "custom") {
      if (!message.display) continue;
      const images = imagesFromContent(message.content, message.timestamp);
      projected.push({
        id,
        role: "custom",
        label: message.customType,
        text: textFromContent(message.content),
        timestamp: message.timestamp,
        ...(images.length > 0 ? { images } : {}),
      });
      continue;
    }
    if (message.role === "compactionSummary") {
      projected.push({
        id,
        role: "status",
        label: "Compaction",
        text: message.summary,
        timestamp: message.timestamp,
      });
      continue;
    }
    if (message.role === "branchSummary") {
      projected.push({
        id,
        role: "status",
        label: "Branch summary",
        text: message.summary,
        timestamp: message.timestamp,
      });
      continue;
    }
    if (message.role === "bashExecution")
      projected.push({
        id,
        role: "bash",
        label: message.command,
        text: message.output,
        timestamp: message.timestamp,
        isError: message.exitCode !== 0,
      });
  }

  return projected;
}
