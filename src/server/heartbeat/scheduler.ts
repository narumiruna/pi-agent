import type { EventHub } from "../agent/events.js";
import type { RunCoordinator } from "../agent/run-coordinator.js";
import type {
  AppStore,
  HeartbeatRunDetails,
  HeartbeatRunRecord,
  HeartbeatRunUpdate,
} from "../storage/types.js";
import type { HeartbeatConfig } from "./config.js";

interface HeartbeatStore
  extends Pick<
    AppStore,
    | "createHeartbeatRun"
    | "finishHeartbeatRun"
    | "latestHeartbeatRun"
    | "listHeartbeatRuns"
  > {}

export interface HeartbeatAgentResult {
  response: string;
  details?: HeartbeatRunDetails;
}

export class HeartbeatExecutionError extends Error {
  constructor(
    message: string,
    readonly details: HeartbeatRunDetails,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "HeartbeatExecutionError";
  }
}

export interface HeartbeatSchedulerOptions {
  load: () => Promise<HeartbeatConfig>;
  coordinator: RunCoordinator;
  events: EventHub;
  runAgent: (prompt: string) => Promise<string | HeartbeatAgentResult>;
  abortAgent?: () => Promise<void>;
  store: HeartbeatStore;
  now?: () => number;
}

function summarize(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 500 ? `${normalized.slice(0, 499)}…` : normalized;
}

export class HeartbeatScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private config?: HeartbeatConfig;

  constructor(private readonly options: HeartbeatSchedulerOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  async start(): Promise<HeartbeatConfig> {
    this.stopTimer();
    this.active = true;
    this.config = await this.options.load();
    if (!this.config.enabled || this.config.diagnostic) return this.config;
    const latest = await this.options.store.latestHeartbeatRun();
    if (latest?.status === "running") {
      await this.options.store.finishHeartbeatRun(latest.id, {
        finishedAt: this.now(),
        status: "error",
        error: "Heartbeat was interrupted by restart",
      });
    }
    const nextAt = latest
      ? latest.startedAt + this.config.everyMs
      : this.now() + this.config.everyMs;
    this.schedule(Math.max(0, nextAt - this.now()));
    return this.config;
  }

  private schedule(delay: number): void {
    if (!this.active || !this.config?.enabled) return;
    this.stopTimer();
    this.timer = setTimeout(() => void this.due(), delay);
  }

  private async due(): Promise<void> {
    this.timer = undefined;
    await this.options.coordinator.waitForIdle();
    if (!this.active) return;
    await this.execute().catch(() => undefined);
    if (this.active && this.config) this.schedule(this.config.everyMs);
  }

  private async execute(): Promise<void> {
    if (!this.config?.enabled || this.config.diagnostic)
      throw new Error(this.config?.diagnostic ?? "Heartbeat is disabled");
    await this.options.coordinator.run(
      "heartbeat",
      async () => {
        const id = crypto.randomUUID();
        const startedAt = this.now();
        const run: HeartbeatRunRecord = { id, startedAt, status: "running" };
        await this.options.store.createHeartbeatRun(run);
        this.options.events.publish("run_status", {
          runId: id,
          kind: "heartbeat",
          status: "running",
        });
        let update: HeartbeatRunUpdate;
        try {
          const result = await this.options.runAgent(this.config?.body ?? "");
          const response =
            typeof result === "string" ? result : result.response;
          update = {
            finishedAt: this.now(),
            status: response === "HEARTBEAT_OK" ? "quiet" : "attention",
            summary: summarize(response),
            ...(typeof result === "string" || !result.details
              ? {}
              : { details: result.details }),
          };
        } catch (error) {
          update = {
            finishedAt: this.now(),
            status: "error",
            error: error instanceof Error ? error.message : "Heartbeat failed",
            ...(error instanceof HeartbeatExecutionError
              ? { details: error.details }
              : {}),
          };
        }
        await this.options.store.finishHeartbeatRun(id, update);
        this.options.events.publish("run_status", {
          runId: id,
          kind: "heartbeat",
          status: update.status,
        });
      },
      this.options.abortAgent,
    );
  }

  async runNow(): Promise<void> {
    this.config = await this.options.load();
    await this.execute();
    if (this.active && this.config.enabled) this.schedule(this.config.everyMs);
  }

  async stop(): Promise<void> {
    this.active = false;
    this.stopTimer();
    if (this.options.coordinator.currentKind === "heartbeat")
      await this.options.coordinator.abort();
  }

  private stopTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  status(): HeartbeatConfig | undefined {
    return this.config;
  }
}
