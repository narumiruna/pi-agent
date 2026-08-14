import { unlink } from "node:fs/promises";
import { join, sep } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  CredentialInfo,
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
import type { AppConfig } from "../config.js";
import type { InteractionBroker } from "../interactions/broker.js";
import {
  createHeadlessTheme,
  createWebExtensionUi,
} from "../interactions/ui.js";
import type { McpManager } from "../mcp/manager.js";
import type { EventHub } from "./events.js";
import { AgentBusyError, RunCoordinator } from "./run-coordinator.js";
import { projectTranscript } from "./transcript.js";

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
        ...(mcp
          ? { resourceLoaderOptions: { extensionFactories: [mcp.extension()] } }
          : {}),
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
    await session.bindExtensions({
      mode: "rpc",
      uiContext: createWebExtensionUi(
        this.interactions,
        this.events,
        createHeadlessTheme(),
      ),
      abortHandler: () => void session.abort(),
      onError: (error) =>
        this.events.publish("notification", {
          type: "error",
          message: error.error,
        }),
    });
    this.unsubscribe = session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        this.events.publish("message_delta", {
          sessionId: session.sessionId,
          delta: event.assistantMessageEvent.delta,
        });
      } else if (event.type === "tool_execution_start") {
        this.events.publish("tool_status", {
          status: "running",
          id: event.toolCallId,
          name: event.toolName,
          args: event.args,
        });
      } else if (event.type === "tool_execution_end") {
        this.events.publish("tool_status", {
          status: event.isError ? "error" : "done",
          id: event.toolCallId,
          name: event.toolName,
          result: event.result,
        });
      }
    });
  }

  get activeSessionId(): string {
    return this.runtime.session.sessionId;
  }

  get activeSession(): AgentSession {
    return this.runtime.session;
  }

  private async nativeSessions() {
    const heartbeatDirectory = `${join(this.config.agentDir, "sessions", "heartbeat")}${sep}`;
    return (await SessionManager.listAll()).filter(
      (session) => !session.path.startsWith(heartbeatDirectory),
    );
  }

  async listConversations(): Promise<ConversationSummary[]> {
    const sessions = await this.nativeSessions();
    return sessions.map((session) => ({
      id: session.id,
      ...(session.name ? { name: session.name } : {}),
      createdAt: session.created.toISOString(),
      modifiedAt: session.modified.toISOString(),
      messageCount: session.messageCount,
      active: session.id === this.activeSessionId,
    }));
  }

  async createConversation(): Promise<string> {
    await this.coordinator.waitForIdle();
    await this.runtime.newSession();
    return this.activeSessionId;
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

  async prompt(id: string, message: string): Promise<string> {
    const text = message.trim();
    if (text.length < 1 || text.length > 100_000)
      throw new Error("Message is invalid");
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
            await this.runtime.session.prompt(text);
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

  async abort(): Promise<void> {
    await this.coordinator.abort();
  }

  async runHeartbeat(prompt: string): Promise<string> {
    await this.heartbeatSession.prompt(prompt);
    const last = [...this.heartbeatSession.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (!last || !Array.isArray(last.content)) return "";
    return last.content
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join("");
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
