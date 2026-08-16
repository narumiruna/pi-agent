import type { PromptDiagnosticCode } from "./prompt-validation.js";

export type {
  PromptDiagnosticCode,
  PromptValidationDiagnostic,
} from "./prompt-validation.js";
export {
  isValidPromptName,
  MAX_PROMPT_CONTENT_BYTES,
  MAX_PROMPT_FILENAME_BYTES,
  MAX_PROMPT_NAME_LENGTH,
  PROMPT_NAME_PATTERN,
} from "./prompt-validation.js";

export const CHAT_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export const MAX_CHAT_IMAGES = 4;
export const MAX_CHAT_IMAGE_BYTES = 4_500_000;
export const MAX_CHAT_IMAGE_BASE64_LENGTH =
  Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4;

export type ChatImageMimeType = (typeof CHAT_IMAGE_MIME_TYPES)[number];

export interface ChatImage {
  type: "image";
  data: string;
  mimeType: ChatImageMimeType;
}

export function normalizeChatImageMimeType(
  value: string,
): ChatImageMimeType | undefined {
  const mimeType = value.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType === "image/jpg") return "image/jpeg";
  return CHAT_IMAGE_MIME_TYPES.find((candidate) => candidate === mimeType);
}

export type ErrorCode =
  | "agent_busy"
  | "bad_request"
  | "cancelled"
  | "conflict"
  | "forbidden"
  | "internal_error"
  | "not_found"
  | "not_ready"
  | "origin_mismatch"
  | "provider_not_configured"
  | "unauthorized";

export type WorkspaceFileReason = "binary" | "read_only" | "too_large";

export interface WorkspaceEntry {
  path: string;
  name: string;
  kind: "directory" | "file";
  modifiedAt: number;
  size?: number;
}

export interface WorkspaceDirectory {
  path: string;
  entries: WorkspaceEntry[];
  truncated: boolean;
  writable: boolean;
}

export interface WorkspaceFile extends WorkspaceEntry {
  kind: "file";
  size: number;
  revision: string;
  downloadable: boolean;
  editable: boolean;
  writable: boolean;
  content?: string;
  reason?: WorkspaceFileReason;
}

export interface WorkspaceMatch {
  path: string;
  directory: boolean;
}

export type WebResourceScope = "project" | "temporary" | "user";
export type WebResourceOrigin = "package" | "top-level";

export interface WebResourceProvenance {
  scope: WebResourceScope;
  origin: WebResourceOrigin;
}

export function resourceProvenanceLabel(
  provenance: WebResourceProvenance,
): string {
  return provenance.origin === "package"
    ? `${provenance.scope} package`
    : provenance.scope;
}

export interface WebResourceCommand {
  id: string;
  name: string;
  description?: string;
  argumentHint?: string;
  source: "extension" | "prompt" | "skill";
  sourceLabel: string;
  provenance: WebResourceProvenance;
}

export interface WebPromptInventory {
  prompts: WebPromptResource[];
  diagnostics: WebPromptDiagnostic[];
  projectTrust: WebProjectTrust;
}

export interface WebPromptDiagnostic {
  code: PromptDiagnosticCode;
  severity: "error" | "warning";
  name?: string;
  path?: string;
  relatedPath?: string;
  promptId?: string;
}

export interface WebPromptTemplateDocument {
  name: string;
  content: string;
  provenance: WebResourceProvenance;
}

export type WebPromptWriteScope = "project" | "user";

export interface WebPromptResource {
  id: string;
  name: string;
  description: string;
  argumentHint?: string;
  content: string;
  contentTruncated: boolean;
  provenance: WebResourceProvenance;
  source: string;
  path: string;
  editable: boolean;
  deletable: boolean;
}

export type WebSkillFileKind = "binary" | "text" | "too_large" | "unavailable";

export interface WebSkillFileEntry {
  path: string;
  size: number;
  kind: WebSkillFileKind;
  entry: boolean;
}

export interface WebSkillResource {
  id: string;
  name: string;
  description: string;
  provenance: WebResourceProvenance;
  source: string;
  path: string;
  files: WebSkillFileEntry[];
  filesTruncated: boolean;
}

export interface WebSkillDiagnostic {
  severity: "error" | "warning";
  message: string;
  path?: string;
  skillId?: string;
}

export interface WebSkillInventory {
  skills: WebSkillResource[];
  diagnostics: WebSkillDiagnostic[];
  projectTrust: WebProjectTrust;
}

export interface WebSkillFileDocument {
  path: string;
  size: number;
  kind: WebSkillFileKind;
  content?: string;
}

export interface WebPackageSummary {
  id: string;
  name: string;
  scope: "project" | "user";
  filtered: boolean;
  provenance: WebResourceProvenance;
}

export interface WebProjectTrust {
  required: boolean;
  trusted: boolean;
}

export interface WebMcpDiagnostic {
  server: string;
  level: "error" | "warning";
  message: string;
}

export interface WebPackageProgress {
  type: "complete" | "error" | "progress" | "start";
  action: "clone" | "install" | "pull" | "remove" | "update";
  message?: string;
}

export type QueueMode = "all" | "one-at-a-time";

export interface ExtensionWidget {
  key: string;
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
}

export interface ExtensionUiSnapshot {
  sessionId: string;
  statuses: Array<{ key: string; text: string }>;
  widgets: ExtensionWidget[];
  title?: string;
  editorText: string;
  workingMessage?: string;
  workingVisible: boolean;
  workingIndicator?: string;
  hiddenThinkingLabel?: string;
  toolsExpanded: boolean;
}

export interface AgentQueueState {
  sessionId: string;
  steering: string[];
  followUp: string[];
}

export interface AgentStats {
  model?: { provider: string; id: string; name: string };
  sessionBytes?: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
}

export interface SessionTreeItem {
  id: string;
  parentId: string | null;
  type: string;
  timestamp: string;
  label?: string;
  preview: string;
  canForkBefore: boolean;
  children: SessionTreeItem[];
}

export interface AgentPreferences {
  steeringMode: QueueMode;
  followUpMode: QueueMode;
  autoCompaction: boolean;
  autoRetry: boolean;
  activeTools: string[];
  availableTools: Array<{ name: string; description: string }>;
}

export interface ConversationAgentState {
  sessionId: string;
  running: boolean;
  queue: AgentQueueState;
  preferences: AgentPreferences;
  stats: AgentStats;
  tree: SessionTreeItem[];
  leafId: string | null;
  treeTruncated: boolean;
  extensionUi: ExtensionUiSnapshot;
}

export interface LiveToolState {
  sessionId: string;
  id: string;
  name: string;
  status: "done" | "error" | "running";
  args?: unknown;
  result?: unknown;
  output?: string;
  diff?: string;
  startedAt: number;
  updatedAt: number;
  durationMs: number;
}

export interface ThinkingState {
  sessionId: string;
  status: "done" | "running";
  delta?: string;
}

export interface AgentActivity {
  sessionId: string;
  kind: "compaction" | "model" | "retry" | "thinking";
  status: string;
  message?: string;
  attempt?: number;
  maxAttempts?: number;
}

export interface WebEventDataMap {
  interaction: Record<string, unknown>;
  message_delta: { sessionId: string; delta: string };
  message_complete: { sessionId: string; role: string; timestamp: number };
  notification: {
    message?: string;
    type?: string;
    [key: string]: unknown;
  };
  package_progress: WebPackageProgress;
  provider_auth: unknown;
  resource_snapshot_changed: Record<string, never>;
  resources_reloaded: Record<string, never>;
  run_status: {
    status: string;
    runId?: string;
    sessionId?: string;
    kind?: string;
    message?: string;
  };
  tool_status: LiveToolState;
  thinking_status: ThinkingState;
  queue_update: AgentQueueState;
  agent_status: AgentActivity;
  agent_config: { sessionId: string; preferences: AgentPreferences };
  extension_ui: {
    snapshot: ExtensionUiSnapshot;
    editor?: { text: string; mode: "append" | "replace" };
  };
}

export type WebEventType = keyof WebEventDataMap;

export type WebEvent = {
  [Type in WebEventType]: {
    id: number;
    type: Type;
    data: WebEventDataMap[Type];
  };
}[WebEventType];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    params?: Record<string, boolean | number | string>;
  };
}

export function apiError(
  code: ErrorCode,
  params?: Record<string, boolean | number | string>,
): ApiErrorBody {
  return params ? { error: { code, params } } : { error: { code } };
}
