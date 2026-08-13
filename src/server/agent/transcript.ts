import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolCall } from "@earendil-works/pi-ai";

export interface TranscriptTool {
  id: string;
  name: string;
  arguments: unknown;
}

export interface TranscriptMessage {
  id: string;
  role: "assistant" | "tool" | "user";
  text: string;
  timestamp: number;
  tools?: TranscriptTool[];
  toolName?: string;
  isError?: boolean;
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
        return [
          {
            role: "user",
            text: textFromContent(message.content),
            timestamp: message.timestamp,
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
