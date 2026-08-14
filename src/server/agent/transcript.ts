import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolCall } from "@earendil-works/pi-ai";
import {
  type ChatImage,
  normalizeChatImageMimeType,
} from "../../shared/contracts.js";

export interface TranscriptTool {
  id: string;
  name: string;
  arguments: unknown;
}

export interface TranscriptImage extends ChatImage {
  id: string;
}

export interface TranscriptMessage {
  id: string;
  role: "assistant" | "tool" | "user";
  text: string;
  timestamp: number;
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

export function projectTranscript(
  messages: AgentMessage[],
): TranscriptMessage[] {
  const projected = messages.flatMap(
    (message): Omit<TranscriptMessage, "id">[] => {
      if (message.role === "user") {
        const images = imagesFromContent(message.content, message.timestamp);
        return [
          {
            role: "user",
            text: textFromContent(message.content),
            timestamp: message.timestamp,
            ...(images.length > 0 ? { images } : {}),
          },
        ];
      }
      if (message.role === "assistant") {
        const tools = Array.isArray(message.content)
          ? message.content
              .filter((part): part is ToolCall => part.type === "toolCall")
              .map((part) => ({
                id: part.id,
                name: part.name,
                arguments: part.arguments,
              }))
          : [];
        return [
          {
            role: "assistant",
            text: textFromContent(message.content),
            timestamp: message.timestamp,
            ...(tools.length > 0 ? { tools } : {}),
          },
        ];
      }
      if (message.role === "toolResult") {
        return [
          {
            role: "tool",
            text: textFromContent(message.content),
            timestamp: message.timestamp,
            toolName: message.toolName,
            isError: message.isError,
          },
        ];
      }
      return [];
    },
  );
  return projected.map((message, index) => ({
    ...message,
    id: `${message.timestamp}-${index}`,
  }));
}
