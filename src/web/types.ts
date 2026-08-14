import type {
  AgentActivity,
  AgentQueueState,
  AgentStats,
  ChatImage,
  ConversationAgentState,
  ExtensionUiSnapshot,
  LiveToolState,
  SessionTreeItem,
  ThinkingState,
} from "../shared/contracts.js";

export type {
  AgentActivity,
  AgentQueueState,
  AgentStats,
  ConversationAgentState,
  ExtensionUiSnapshot,
  LiveToolState,
  SessionTreeItem,
  ThinkingState,
};

export interface SessionInfo {
  authenticated: boolean;
  authDisabled: boolean;
  owner?: string;
  tools: string[];
}

export interface Conversation {
  id: string;
  name?: string;
  createdAt: string;
  modifiedAt: string;
  messageCount: number;
  active: boolean;
}

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

export type LiveTool = LiveToolState;

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

export interface HeartbeatToolDetail {
  id: string;
  name: string;
  input?: string;
  output?: string;
  diff?: string;
  isError: boolean;
}

export interface HeartbeatRunDetails {
  response?: string;
  reasoning?: string;
  tools?: HeartbeatToolDetail[];
}

export interface HeartbeatRun {
  id: string;
  startedAt: number;
  finishedAt?: number;
  status: "attention" | "error" | "quiet" | "running" | "stopped";
  summary?: string;
  error?: string;
  details?: HeartbeatRunDetails;
}

export interface InteractionEvent {
  id: string;
  kind: "confirm" | "editor" | "input" | "secret" | "select" | "text";
  scope?: "provider_auth";
  title?: string;
  message?: string;
  options?: Array<string | { id: string; label: string; description?: string }>;
  placeholder?: string;
  prefill?: string;
}
