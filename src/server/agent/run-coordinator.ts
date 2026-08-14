export type RunKind = "chat" | "heartbeat" | "maintenance";

export class AgentBusyError extends Error {
  readonly code = "agent_busy";

  constructor() {
    super("The agent is already running");
  }
}

export class RunCoordinator {
  private current: { kind: RunKind; abort?: () => Promise<void> } | undefined;
  private idleWaiters = new Set<() => void>();

  get isIdle(): boolean {
    return this.current === undefined;
  }

  get currentKind(): RunKind | undefined {
    return this.current?.kind;
  }

  async run<T>(
    kind: RunKind,
    task: () => Promise<T>,
    abort?: () => Promise<void>,
  ): Promise<T> {
    if (this.current) throw new AgentBusyError();
    this.current = abort ? { kind, abort } : { kind };
    try {
      return await task();
    } finally {
      this.current = undefined;
      for (const waiter of this.idleWaiters) waiter();
      this.idleWaiters.clear();
    }
  }

  async abort(): Promise<void> {
    await this.current?.abort?.();
  }

  waitForIdle(): Promise<void> {
    if (this.isIdle) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }
}
