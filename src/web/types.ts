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

export interface TranscriptTool {
  id: string;
  name: string;
  arguments: unknown;
}

export interface LiveTool {
  id: string;
  name: string;
  status: "done" | "error" | "running";
  args?: unknown;
  result?: unknown;
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

export interface HeartbeatRun {
  id: string;
  startedAt: number;
  finishedAt?: number;
  status: "attention" | "error" | "quiet" | "running" | "stopped";
  summary?: string;
  error?: string;
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
