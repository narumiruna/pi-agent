import { statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join, sep } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  CredentialInfo,
  ImageContent,
  Model,
} from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  DefaultPackageManager,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentPreferences,
  AgentQueueState,
  AgentStats,
  ConversationAgentState,
  QueueMode,
} from "../../shared/contracts.js";
import type { AppConfig } from "../config.js";
import { HeartbeatExecutionError } from "../heartbeat/scheduler.js";
import type { InteractionBroker } from "../interactions/broker.js";
import {
  sanitizeExtensionText,
  WebExtensionState,
} from "../interactions/web-state.js";
import type { McpManager } from "../mcp/manager.js";
import type { HeartbeatRunDetails } from "../storage/types.js";
import type { EventHub } from "./events.js";
import {
  heartbeatExecutionPrompt,
  heartbeatFileGuidance,
  validateUserInput,
} from "./prompt-input.js";
import { AgentBusyError, RunCoordinator } from "./run-coordinator.js";
import { bindWebSessionEvents } from "./session-events.js";
import {
  type ConversationExport,
  exportSession,
  validateSessionImport,
  withSessionImport,
} from "./session-transfer.js";
import { projectTranscript } from "./transcript.js";
import { boundedQueue, projectSessionTree } from "./web-projection.js";

function redactHeartbeatText(value: string): string {
  return value
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 [REDACTED]")
    .replace(
      /((?:api[_-]?key|token|password|secret|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
      "$1[REDACTED]",
    );
}

function stringifyHeartbeatInput(value: unknown): string | undefined {
  try {
    const json = JSON.stringify(
      value,
      (key, item: unknown) =>
        key && /api[_-]?key|token|password|secret|authorization/i.test(key)
          ? "[REDACTED]"
          : item,
      2,
    );
    return json === undefined
      ? undefined
      : sanitizeExtensionText(redactHeartbeatText(json), 2_000);
  } catch {
    return "[Input could not be serialized]";
  }
}

function heartbeatResponse(
  messages: Parameters<typeof projectTranscript>[0],
): string {
  const last = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  if (!last || !Array.isArray(last.content)) return "";
  return sanitizeExtensionText(
    redactHeartbeatText(
      last.content
        .filter(
          (part): part is { type: "text"; text: string } =>
            part.type === "text",
        )
        .map((part) => part.text)
        .join(""),
    ),
    20_000,
  );
}

function projectHeartbeatDetails(
  messages: Parameters<typeof projectTranscript>[0],
  response: string,
): HeartbeatRunDetails {
  const transcript = projectTranscript(messages);
  const reasoning = transcript
    .flatMap((message) => (message.thinking ? [message.thinking] : []))
    .join("\n\n");
  const tools = transcript.flatMap((message) =>
    (message.tools ?? []).map((tool) => {
      const input = stringifyHeartbeatInput(tool.arguments);
      return {
        id: sanitizeExtensionText(tool.id, 200),
        name: sanitizeExtensionText(tool.name, 200),
        ...(input ? { input } : {}),
        ...(tool.result?.text
          ? {
              output: sanitizeExtensionText(
                redactHeartbeatText(tool.result.text),
                5_000,
              ),
            }
          : {}),
        ...(tool.result?.diff
          ? {
              diff: sanitizeExtensionText(
                redactHeartbeatText(tool.result.diff),
                2_000,
              ),
            }
          : {}),
        isError: tool.result?.isError ?? false,
      };
    }),
  );
  return {
    ...(response ? { response } : {}),
    ...(reasoning
      ? {
          reasoning: sanitizeExtensionText(
            redactHeartbeatText(reasoning),
            20_000,
          ),
        }
      : {}),
    ...(tools.length > 0 ? { tools: tools.slice(0, 10) } : {}),
  };
}

export interface ConversationSummary {
  id: string;
  name?: string;
  createdAt: string;
  modifiedAt: string;
  messageCount: number;
  active: boolean;
}

export type ProviderAuthPhase =
  | "cancelled"
  | "failed"
  | "starting"
  | "succeeded"
  | "waiting";

export interface ProviderAuthTask {
  providerId: string;
  providerName: string;
  phase: ProviderAuthPhase;
  method?: string;
  message?: string;
  url?: string;
  userCode?: string;
  verificationUri?: string;
  expiresAt?: number;
  error?: "login_failed";
}

export interface ProviderAccess {
  id: string;
  name: string;
  status: {
    configured: boolean;
    source?: string;
    label?: string;
    credentialType?: "api_key" | "oauth";
    disconnectable: boolean;
  };
  auth: {
    apiKey?: { name: string };
    oauth?: {
      name: string;
      loginLabel?: string;
      subscription: boolean;
    };
  };
}

export class PiService {
  readonly coordinator = new RunCoordinator();
  readonly modelRuntime: ModelRuntime;
  readonly settingsManager: SettingsManager;
  readonly packageManager: DefaultPackageManager;
  private readonly runtime: AgentSessionRuntime;
  private readonly extensionState: WebExtensionState;
  private providerLoginAbort: AbortController | undefined;
  private providerLoginSettled: Promise<void> | undefined;
  private currentProviderAuthTask: ProviderAuthTask | undefined;
  private unsubscribe?: () => void;

  private constructor(
    private readonly config: AppConfig,
    readonly events: EventHub,
    modelRuntime: ModelRuntime,
    settingsManager: SettingsManager,
    packageManager: DefaultPackageManager,
    runtime: AgentSessionRuntime,
    private readonly heartbeatSession: AgentSession,
    private readonly interactions: InteractionBroker,
  ) {
    this.modelRuntime = modelRuntime;
    this.settingsManager = settingsManager;
    this.packageManager = packageManager;
    this.runtime = runtime;
    this.extensionState = new WebExtensionState(events);
    runtime.setRebindSession(async (session) => this.bindSession(session));
    packageManager.setProgressCallback((event) =>
      this.events.publish("package_progress", event),
    );
  }

  static async create(
    config: AppConfig,
    events: EventHub,
    interactions: InteractionBroker,
    mcp?: McpManager,
  ): Promise<PiService> {
    process.env.PI_CODING_AGENT_DIR = config.agentDir;
    const settingsManager = SettingsManager.create(
      config.workspace,
      config.agentDir,
      { projectTrusted: false },
    );
    const heartbeatGuidance = heartbeatFileGuidance(config.agentDir);
    const modelRuntime = await ModelRuntime.create({
      authPath: join(config.agentDir, "auth.json"),
      modelsPath: join(config.agentDir, "models.json"),
    });
    const packageManager = new DefaultPackageManager({
      cwd: config.workspace,
      agentDir: config.agentDir,
      settingsManager,
    });
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({
      cwd,
      sessionManager,
      sessionStartEvent,
    }) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir: config.agentDir,
        settingsManager,
        modelRuntime,
        resourceLoaderOptions: {
          appendSystemPrompt: [heartbeatGuidance],
          ...(mcp ? { extensionFactories: [mcp.extension()] } : {}),
        },
      });
      return {
        ...(await createAgentSessionFromServices({
          services,
          sessionManager,
          ...(sessionStartEvent ? { sessionStartEvent } : {}),
          tools: config.agentTools,
        })),
        services,
        diagnostics: services.diagnostics,
      };
    };
    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: config.workspace,
      agentDir: config.agentDir,
      sessionManager: SessionManager.create(config.workspace),
    });
    const heartbeatServices = await createAgentSessionServices({
      cwd: config.workspace,
      agentDir: config.agentDir,
      settingsManager,
      modelRuntime,
      resourceLoaderOptions: { noExtensions: true },
    });
    const { session: heartbeatSession } = await createAgentSessionFromServices({
      services: heartbeatServices,
      sessionManager: SessionManager.continueRecent(
        config.workspace,
        join(config.agentDir, "sessions", "heartbeat"),
      ),
      tools: config.agentTools,
    });
    const service = new PiService(
      config,
      events,
      modelRuntime,
      settingsManager,
      packageManager,
      runtime,
      heartbeatSession,
      interactions,
    );
    await service.bindSession(runtime.session);
    return service;
  }

  private async bindSession(session: AgentSession): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = await bindWebSessionEvents({
      session,
      events: this.events,
      interactions: this.interactions,
      extensionState: this.extensionState,
    });
  }

  get activeSessionId(): string {
    return this.runtime.session.sessionId;
  }

  get activeSession(): AgentSession {
    return this.runtime.session;
  }

  private queueState(session = this.activeSession): AgentQueueState {
    return {
      sessionId: session.sessionId,
      steering: boundedQueue(session.getSteeringMessages()),
      followUp: boundedQueue(session.getFollowUpMessages()),
    };
  }

  private clearCurrentQueue() {
    const session = this.activeSession;
    const cleared = session.clearQueue();
    const queue = this.queueState(session);
    this.events.publish("queue_update", queue);
    return {
      queue,
      restored: [...cleared.steering, ...cleared.followUp],
    };
  }

  preferences(): AgentPreferences {
    const session = this.activeSession;
    return {
      steeringMode: session.steeringMode,
      followUpMode: session.followUpMode,
      autoCompaction: session.autoCompactionEnabled,
      autoRetry: session.autoRetryEnabled,
      activeTools: session.getActiveToolNames(),
      availableTools: session.getAllTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    };
  }

  private stats(): AgentStats {
    const {
      sessionFile,
      sessionId: _sessionId,
      ...stats
    } = this.activeSession.getSessionStats();
    const model = this.activeSession.model;
    let sessionBytes: number | undefined;
    if (sessionFile) {
      try {
        sessionBytes = statSync(sessionFile).size;
      } catch {
        // A new in-memory session may not have a file yet.
      }
    }
    return {
      ...stats,
      ...(model
        ? {
            model: {
              provider: model.provider,
              id: model.id,
              name: model.name,
            },
          }
        : {}),
      ...(sessionBytes !== undefined ? { sessionBytes } : {}),
    };
  }

  private requireActiveConversation(id: string): void {
    if (id !== this.activeSessionId)
      throw new Error("Conversation is not the active conversation");
  }

  private requireIdle(): void {
    if (!this.coordinator.isIdle || !this.activeSession.isIdle)
      throw new AgentBusyError();
  }

  private async nativeSessions() {
    const heartbeatDirectory = `${join(this.config.agentDir, "sessions", "heartbeat")}${sep}`;
    return (await SessionManager.listAll()).filter(
      (session) => !session.path.startsWith(heartbeatDirectory),
    );
  }

  async listConversations(): Promise<ConversationSummary[]> {
    const sessions = await this.nativeSessions();
    const conversations = sessions.map((session) => ({
      id: session.id,
      ...(session.name ? { name: session.name } : {}),
      createdAt: session.created.toISOString(),
      modifiedAt: session.modified.toISOString(),
      messageCount: session.messageCount,
      active: session.id === this.activeSessionId,
    }));
    if (!conversations.some((conversation) => conversation.active)) {
      const active = this.activeSession;
      const timestamp = new Date().toISOString();
      conversations.unshift({
        id: active.sessionId,
        ...(active.sessionName ? { name: active.sessionName } : {}),
        createdAt: timestamp,
        modifiedAt: timestamp,
        messageCount: active.messages.length,
        active: true,
      });
    }
    return conversations;
  }

  async createConversation(): Promise<string> {
    await this.coordinator.waitForIdle();
    await this.runtime.newSession();
    return this.activeSessionId;
  }

  async activateConversation(id: string): Promise<void> {
    this.requireIdle();
    await this.switchConversation(id);
  }

  conversationState(id: string): ConversationAgentState {
    this.requireActiveConversation(id);
    const tree = projectSessionTree(
      this.activeSession.sessionManager.getTree(),
    );
    return {
      sessionId: id,
      running:
        this.coordinator.currentKind === "chat" &&
        this.activeSession.isStreaming,
      queue: this.queueState(),
      preferences: this.preferences(),
      stats: this.stats(),
      tree: tree.tree,
      leafId: this.activeSession.sessionManager.getLeafId(),
      treeTruncated: tree.truncated,
      extensionUi: this.extensionState.snapshot(),
    };
  }

  setComposerDraft(id: string, text: string): void {
    this.requireActiveConversation(id);
    if (text.length > 100_000) throw new Error("Message is invalid");
    this.extensionState.setComposerFromClient(text);
  }

  async switchConversation(id: string): Promise<void> {
    if (id === this.activeSessionId) return;
    await this.coordinator.waitForIdle();
    const target = (await this.nativeSessions()).find(
      (session) => session.id === id,
    );
    if (!target) throw new Error("Conversation not found");
    await this.runtime.switchSession(target.path, {
      cwdOverride: this.config.workspace,
    });
  }

  async renameConversation(id: string, name: string): Promise<void> {
    const normalized = name.trim();
    if (normalized.length < 1 || normalized.length > 120)
      throw new Error("Conversation name is invalid");
    await this.switchConversation(id);
    this.runtime.session.setSessionName(normalized);
  }

  async deleteConversation(id: string): Promise<void> {
    if (id === this.activeSessionId)
      throw new Error("The active conversation cannot be deleted");
    const target = (await this.nativeSessions()).find(
      (session) => session.id === id,
    );
    if (!target) throw new Error("Conversation not found");
    await unlink(target.path);
  }

  async transcript(id: string) {
    if (id === this.activeSessionId)
      return projectTranscript(this.runtime.session.messages);
    const target = (await this.nativeSessions()).find(
      (session) => session.id === id,
    );
    if (!target) throw new Error("Conversation not found");
    return projectTranscript(
      SessionManager.open(
        target.path,
        undefined,
        this.config.workspace,
      ).buildSessionContext().messages,
    );
  }

  async prompt(
    id: string,
    message: string,
    images?: ImageContent[],
  ): Promise<string> {
    const input = validateUserInput(message, images);
    if (!this.coordinator.isIdle) throw new AgentBusyError();
    await this.switchConversation(id);
    if (!this.coordinator.isIdle) throw new AgentBusyError();
    const runId = crypto.randomUUID();
    void this.coordinator
      .run(
        "chat",
        async () => {
          this.events.publish("run_status", {
            runId,
            sessionId: id,
            status: "running",
          });
          try {
            if (input.images.length > 0)
              await this.runtime.session.prompt(input.text, {
                images: input.images,
              });
            else await this.runtime.session.prompt(input.text);
            this.events.publish("run_status", {
              runId,
              sessionId: id,
              status: "done",
            });
          } catch (error) {
            this.events.publish("run_status", {
              runId,
              sessionId: id,
              status: "error",
              message:
                error instanceof Error ? error.message : "Agent run failed",
            });
          }
        },
        () => this.runtime.session.abort(),
      )
      .catch(() => undefined);
    return runId;
  }

  async steer(
    id: string,
    message: string,
    images?: ImageContent[],
  ): Promise<void> {
    const input = validateUserInput(message, images);
    if (
      this.coordinator.currentKind !== "chat" ||
      id !== this.activeSessionId ||
      !this.runtime.session.isStreaming
    )
      throw new Error(
        "Steering requires an active chat run in this conversation",
      );
    await this.runtime.session.prompt(input.text, {
      streamingBehavior: "steer",
      ...(input.images.length > 0 ? { images: input.images } : {}),
    });
  }

  async followUp(
    id: string,
    message: string,
    images?: ImageContent[],
  ): Promise<void> {
    const input = validateUserInput(message, images);
    if (
      this.coordinator.currentKind !== "chat" ||
      id !== this.activeSessionId ||
      !this.runtime.session.isStreaming
    )
      throw new Error(
        "Follow-up requires an active chat run in this conversation",
      );
    await this.runtime.session.prompt(input.text, {
      streamingBehavior: "followUp",
      ...(input.images.length > 0 ? { images: input.images } : {}),
    });
  }

  clearQueue(id: string) {
    this.requireActiveConversation(id);
    return this.clearCurrentQueue();
  }

  async abort() {
    const chat = this.coordinator.currentKind === "chat";
    await this.coordinator.abort();
    return chat ? this.clearCurrentQueue() : undefined;
  }

  setPreferences(input: {
    steeringMode?: QueueMode;
    followUpMode?: QueueMode;
    autoCompaction?: boolean;
    autoRetry?: boolean;
    activeTools?: string[];
  }): AgentPreferences {
    this.requireIdle();
    const session = this.activeSession;
    const activeTools = input.activeTools
      ? [...new Set(input.activeTools)]
      : undefined;
    if (activeTools) {
      const available = new Set(session.getAllTools().map((tool) => tool.name));
      if (
        activeTools.length < 1 ||
        activeTools.some((name) => !available.has(name))
      )
        throw new Error("Active tools are invalid");
    }
    if (input.steeringMode) session.setSteeringMode(input.steeringMode);
    if (input.followUpMode) session.setFollowUpMode(input.followUpMode);
    if (input.autoCompaction !== undefined)
      session.setAutoCompactionEnabled(input.autoCompaction);
    if (input.autoRetry !== undefined)
      session.setAutoRetryEnabled(input.autoRetry);
    if (activeTools) session.setActiveToolsByName(activeTools);
    const preferences = this.preferences();
    this.events.publish("agent_config", {
      sessionId: session.sessionId,
      preferences,
    });
    return preferences;
  }

  async navigateConversationTree(
    id: string,
    targetId: string,
    options: {
      summarize?: boolean;
      customInstructions?: string;
      label?: string;
    },
  ) {
    this.requireIdle();
    await this.switchConversation(id);
    this.requireIdle();
    if (!this.activeSession.sessionManager.getEntry(targetId))
      throw new Error("Session entry not found");
    return this.coordinator.run(
      "maintenance",
      () => this.activeSession.navigateTree(targetId, options),
      async () => this.activeSession.abortBranchSummary(),
    );
  }

  async forkConversation(
    id: string,
    targetId: string,
    position: "at" | "before",
  ): Promise<{ id: string; selectedText?: string }> {
    this.requireIdle();
    await this.switchConversation(id);
    this.requireIdle();
    if (!this.activeSession.sessionManager.getEntry(targetId))
      throw new Error("Session entry not found");
    const result = await this.coordinator.run("maintenance", () =>
      this.runtime.fork(targetId, { position }),
    );
    if (result.cancelled)
      throw new DOMException("Session fork was cancelled", "AbortError");
    if (result.selectedText)
      this.extensionState.setEditorText(result.selectedText, "replace");
    return {
      id: this.activeSessionId,
      ...(result.selectedText ? { selectedText: result.selectedText } : {}),
    };
  }

  async compactConversation(
    id: string,
    customInstructions?: string,
  ): Promise<{
    summary: string;
    tokensBefore: number;
    estimatedTokensAfter?: number;
  }> {
    this.requireIdle();
    await this.switchConversation(id);
    this.requireIdle();
    const instructions = customInstructions?.trim();
    if (instructions && instructions.length > 10_000)
      throw new Error("Compaction instructions are invalid");
    const result = await this.coordinator.run(
      "maintenance",
      () => this.activeSession.compact(instructions),
      async () => this.activeSession.abortCompaction(),
    );
    return {
      summary: result.summary,
      tokensBefore: result.tokensBefore,
      ...(result.estimatedTokensAfter !== undefined
        ? { estimatedTokensAfter: result.estimatedTokensAfter }
        : {}),
    };
  }

  async exportConversation(
    id: string,
    format: "html" | "jsonl",
  ): Promise<ConversationExport> {
    this.requireActiveConversation(id);
    this.requireIdle();
    return this.coordinator.run("maintenance", () =>
      exportSession(this.activeSession, this.config.dataDir, id, format),
    );
  }

  async importConversation(content: string): Promise<string> {
    this.requireIdle();
    validateSessionImport(
      content,
      new Set((await this.nativeSessions()).map((session) => session.id)),
    );
    const result = await this.coordinator.run("maintenance", () =>
      withSessionImport(this.config.dataDir, content, (inputPath) =>
        this.runtime.importFromJsonl(inputPath, this.config.workspace),
      ),
    );
    if (result.cancelled)
      throw new DOMException("Session import was cancelled", "AbortError");
    return this.activeSessionId;
  }

  heartbeatRunDetails(
    startedAt: number,
    finishedAt = Date.now(),
  ): HeartbeatRunDetails | undefined {
    const messages = this.heartbeatSession.messages.filter(
      (message) =>
        message.timestamp >= startedAt && message.timestamp <= finishedAt,
    );
    if (messages.length === 0) return undefined;
    const response = heartbeatResponse(messages);
    return projectHeartbeatDetails(messages, response);
  }

  async runHeartbeat(prompt: string) {
    const previousMessages = new Set(this.heartbeatSession.messages);
    try {
      await this.heartbeatSession.prompt(heartbeatExecutionPrompt(prompt));
    } catch (cause) {
      const runMessages = this.heartbeatSession.messages.filter(
        (message) => !previousMessages.has(message),
      );
      throw new HeartbeatExecutionError(
        cause instanceof Error
          ? redactHeartbeatText(cause.message)
          : "Heartbeat failed",
        projectHeartbeatDetails(runMessages, heartbeatResponse(runMessages)),
        cause,
      );
    }
    const runMessages = this.heartbeatSession.messages.filter(
      (message) => !previousMessages.has(message),
    );
    const response = heartbeatResponse(runMessages);
    return {
      response,
      details: projectHeartbeatDetails(runMessages, response),
    };
  }

  async abortHeartbeat(): Promise<void> {
    await this.heartbeatSession.abort();
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    const model = this.modelRuntime.getModel(provider, modelId);
    if (!model) throw new Error("Model not found");
    const previousHeartbeatModel = this.heartbeatSession.model;
    await this.heartbeatSession.setModel(model);
    try {
      await this.runtime.session.setModel(model);
      this.events.publish("agent_status", {
        sessionId: this.activeSessionId,
        kind: "model",
        status: "changed",
        message: `${model.provider}/${model.id}`,
      });
    } catch (error) {
      if (previousHeartbeatModel)
        await this.heartbeatSession.setModel(previousHeartbeatModel);
      throw error;
    }
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this.runtime.session.setThinkingLevel(level);
    this.heartbeatSession.setThinkingLevel(level);
  }

  get providerLoginPending(): boolean {
    return Boolean(this.providerLoginAbort);
  }

  providerAuthTask(): ProviderAuthTask | undefined {
    return this.currentProviderAuthTask
      ? { ...this.currentProviderAuthTask }
      : undefined;
  }

  dismissProviderAuthTask(): void {
    if (this.providerLoginPending) return;
    this.currentProviderAuthTask = undefined;
    this.events.publish("provider_auth", { phase: "dismissed" });
  }

  private publishProviderAuthTask(task: ProviderAuthTask): void {
    this.currentProviderAuthTask = task;
    this.events.publish("provider_auth", task);
  }

  private activeProviderAuthTask(): ProviderAuthTask | undefined {
    const task = this.currentProviderAuthTask;
    return task?.phase === "starting" || task?.phase === "waiting"
      ? task
      : undefined;
  }

  private finishProviderAuthTask(
    task: ProviderAuthTask,
    phase: "cancelled" | "failed" | "succeeded",
  ): void {
    this.publishProviderAuthTask({
      providerId: task.providerId,
      providerName: task.providerName,
      phase,
      ...(phase === "failed" ? { error: "login_failed" as const } : {}),
    });
  }

  private providerName(providerId: string): string {
    return (
      this.modelRuntime
        .getProviders()
        .find((provider) => provider.id === providerId)?.name ?? providerId
    );
  }

  private updateProviderAuthPrompt(prompt: AuthPrompt): void {
    const task = this.currentProviderAuthTask;
    if (!task) return;
    const method =
      prompt.type === "select" &&
      prompt.options.some((option) => option.id === "device_code")
        ? "choose_method"
        : task.method;
    this.publishProviderAuthTask({
      ...task,
      phase: "waiting",
      ...(method ? { method } : {}),
      message: prompt.message,
    });
  }

  private updateProviderAuthEvent(event: AuthEvent): void {
    const task = this.currentProviderAuthTask;
    if (!task) return;
    if (event.type === "device_code") {
      this.publishProviderAuthTask({
        providerId: task.providerId,
        providerName: task.providerName,
        phase: "waiting",
        method: "device_code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(event.expiresInSeconds
          ? { expiresAt: Date.now() + event.expiresInSeconds * 1_000 }
          : {}),
      });
      return;
    }
    if (event.type === "auth_url") {
      this.publishProviderAuthTask({
        providerId: task.providerId,
        providerName: task.providerName,
        phase: "waiting",
        method: "browser",
        url: event.url,
        ...(event.instructions ? { message: event.instructions } : {}),
      });
      return;
    }
    this.publishProviderAuthTask({
      ...task,
      phase: "waiting",
      message: event.message,
      ...(event.type === "info" && event.links?.[0]
        ? { url: event.links[0].url }
        : {}),
    });
  }

  async providerAccess(): Promise<ProviderAccess[]> {
    const credentials = new Map<string, CredentialInfo>(
      (await this.modelRuntime.listCredentials()).map((credential) => [
        credential.providerId,
        credential,
      ]),
    );
    return this.modelRuntime.getProviders().map((provider) => {
      const status = this.modelRuntime.getProviderAuthStatus(provider.id);
      const credential = credentials.get(provider.id);
      const credentialType =
        credential?.type ??
        (status.configured
          ? this.modelRuntime.isUsingOAuth(provider.id)
            ? "oauth"
            : "api_key"
          : undefined);
      return {
        id: provider.id,
        name: provider.name,
        status: {
          ...status,
          ...(credentialType ? { credentialType } : {}),
          disconnectable: Boolean(credential),
        },
        auth: {
          ...(provider.auth.apiKey?.login
            ? { apiKey: { name: provider.auth.apiKey.name } }
            : {}),
          ...(provider.auth.oauth
            ? {
                oauth: {
                  name: provider.auth.oauth.name,
                  ...(provider.auth.oauth.loginLabel
                    ? { loginLabel: provider.auth.oauth.loginLabel }
                    : {}),
                  subscription: provider.auth.oauth.isSubscription === true,
                },
              }
            : {}),
        },
      };
    });
  }

  async providerLogin(
    providerId: string,
    type: "api_key" | "oauth",
    apiKey?: string,
  ): Promise<void> {
    if (this.providerLoginAbort)
      throw new Error("Provider authentication is already in progress");
    const abort = new AbortController();
    let settleProviderLogin: () => void = () => undefined;
    const providerLoginSettled = new Promise<void>((resolve) => {
      settleProviderLogin = resolve;
    });
    this.providerLoginAbort = abort;
    this.providerLoginSettled = providerLoginSettled;
    if (type === "oauth")
      this.publishProviderAuthTask({
        providerId,
        providerName: this.providerName(providerId),
        phase: "starting",
      });
    let submittedKey = apiKey;
    const interaction: AuthInteraction = {
      signal: abort.signal,
      prompt: (prompt: AuthPrompt) => {
        if (prompt.type === "secret" && submittedKey !== undefined) {
          const key = submittedKey;
          submittedKey = undefined;
          return Promise.resolve(key);
        }
        this.updateProviderAuthPrompt(prompt);
        return this.interactions.prompt(
          { ...prompt, signal: abort.signal },
          type === "oauth" ? "provider_auth" : undefined,
        );
      },
      notify: (event) => this.updateProviderAuthEvent(event),
    };
    try {
      await this.modelRuntime.login(providerId, type, interaction);
      const task = this.activeProviderAuthTask();
      if (task) this.finishProviderAuthTask(task, "succeeded");
    } catch (error) {
      const task = this.activeProviderAuthTask();
      if (task)
        this.finishProviderAuthTask(
          task,
          abort.signal.aborted ? "cancelled" : "failed",
        );
      if (abort.signal.aborted)
        throw new DOMException("Authentication cancelled", "AbortError");
      throw error;
    } finally {
      if (this.providerLoginAbort === abort)
        this.providerLoginAbort = undefined;
      if (this.providerLoginSettled === providerLoginSettled)
        this.providerLoginSettled = undefined;
      settleProviderLogin();
    }
  }

  async cancelProviderLogin(): Promise<void> {
    const abort = this.providerLoginAbort;
    if (!abort) return;
    const settled = this.providerLoginSettled;
    const task = this.activeProviderAuthTask();
    if (task) this.finishProviderAuthTask(task, "cancelled");
    abort.abort(new DOMException("Authentication cancelled", "AbortError"));
    await settled;
  }

  async providerLogout(providerId: string): Promise<void> {
    const stored = (await this.modelRuntime.listCredentials()).some(
      (credential) => credential.providerId === providerId,
    );
    if (!stored) throw new Error("Stored provider credential not found");
    await this.modelRuntime.logout(providerId);
  }

  async reload(): Promise<void> {
    await this.coordinator.waitForIdle();
    await this.runtime.session.reload();
    await this.heartbeatSession.reload();
  }

  models(): readonly Model<Api>[] {
    return this.modelRuntime.getAvailableSnapshot();
  }

  commands(): Array<{
    name: string;
    description?: string;
    source: "extension" | "prompt" | "skill";
  }> {
    const result: Array<{
      name: string;
      description?: string;
      source: "extension" | "prompt" | "skill";
    }> = [];
    for (const extension of this.runtime.services.resourceLoader.getExtensions()
      .extensions) {
      for (const [name, command] of extension.commands) {
        result.push({
          name,
          ...(command.description ? { description: command.description } : {}),
          source: "extension",
        });
      }
    }
    for (const prompt of this.runtime.session.promptTemplates) {
      result.push({
        name: prompt.name,
        ...(prompt.description ? { description: prompt.description } : {}),
        source: "prompt",
      });
    }
    for (const skill of this.runtime.services.resourceLoader.getSkills()
      .skills) {
      result.push({
        name: `skill:${skill.name}`,
        description: skill.description,
        source: "skill",
      });
    }
    return result;
  }

  diagnostics() {
    return {
      runtime: this.runtime.diagnostics,
      skills: this.runtime.services.resourceLoader.getSkills().diagnostics,
      prompts: this.runtime.services.resourceLoader.getPrompts().diagnostics,
      extensions: this.runtime.services.resourceLoader.getExtensions().errors,
    };
  }

  async dispose(): Promise<void> {
    await this.cancelProviderLogin();
    this.unsubscribe?.();
    await this.settingsManager.flush();
    this.heartbeatSession.dispose();
    await this.runtime.dispose();
  }
}
