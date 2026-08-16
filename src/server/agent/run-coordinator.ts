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
  private snapshotWaiters = new Set<() => void>();
  private snapshotReaders = 0;
  private pendingMaintenance = 0;

  get isIdle(): boolean {
    return this.current === undefined && this.pendingMaintenance === 0;
  }

  get currentKind(): RunKind | undefined {
    return this.current?.kind;
  }

  private notifySnapshotWaiters(): void {
    for (const waiter of this.snapshotWaiters) waiter();
    this.snapshotWaiters.clear();
  }

  private waitForSnapshotChange(): Promise<void> {
    return new Promise((resolve) => this.snapshotWaiters.add(resolve));
  }

  async run<T>(
    kind: RunKind,
    task: () => Promise<T>,
    abort?: () => Promise<void>,
  ): Promise<T> {
    if (this.current || (kind !== "maintenance" && this.pendingMaintenance > 0))
      throw new AgentBusyError();
    if (kind === "maintenance") {
      this.pendingMaintenance++;
      try {
        while (this.snapshotReaders > 0) await this.waitForSnapshotChange();
        if (this.current) throw new AgentBusyError();
        this.current = abort ? { kind, abort } : { kind };
      } finally {
        this.pendingMaintenance--;
        this.notifySnapshotWaiters();
      }
    } else {
      this.current = abort ? { kind, abort } : { kind };
    }
    try {
      return await task();
    } finally {
      this.current = undefined;
      for (const waiter of this.idleWaiters) waiter();
      this.idleWaiters.clear();
      this.notifySnapshotWaiters();
    }
  }

  async readSnapshot<T>(task: () => Promise<T> | T): Promise<T> {
    while (this.current?.kind === "maintenance" || this.pendingMaintenance > 0)
      await this.waitForSnapshotChange();
    this.snapshotReaders++;
    try {
      return await task();
    } finally {
      this.snapshotReaders--;
      this.notifySnapshotWaiters();
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
