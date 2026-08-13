import { describe, expect, test, vi } from "vitest";
import { EventHub } from "../../src/server/agent/events.js";
import { RunCoordinator } from "../../src/server/agent/run-coordinator.js";
import { parseHeartbeat } from "../../src/server/heartbeat/config.js";
import { HeartbeatScheduler } from "../../src/server/heartbeat/scheduler.js";
import type { HeartbeatRunRecord } from "../../src/server/storage/types.js";

describe("parseHeartbeat", () => {
  test("uses frontmatter, Windows line endings, and defaults", () => {
    expect(parseHeartbeat("Check the inbox.")).toMatchObject({
      enabled: true,
      everyMs: 1_800_000,
      body: "Check the inbox.",
    });
    expect(
      parseHeartbeat("---\nenabled: false\nevery: 2h\n---\nCheck."),
    ).toMatchObject({
      enabled: false,
      everyMs: 7_200_000,
      body: "Check.",
    });
    expect(parseHeartbeat("---\r\nevery: 1h\r\n---\r\nCheck.")).toMatchObject({
      enabled: true,
      everyMs: 3_600_000,
      body: "Check.",
    });
  });

  test.each([
    "",
    "---\nevery: 0m\n---\nCheck",
    "---\nenabled: yes\n---\nCheck",
    "---\n: bad\n---\nCheck",
  ])("returns a diagnostic for invalid input %j", (content) => {
    expect(parseHeartbeat(content).diagnostic).toBeDefined();
  });
});

describe("HeartbeatScheduler", () => {
  test("waits one interval on first start and catches up only once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const runs: HeartbeatRunRecord[] = [];
    const runAgent = vi.fn(async () => "HEARTBEAT_OK");
    const scheduler = new HeartbeatScheduler({
      load: async () => parseHeartbeat("---\nevery: 1m\n---\nCheck"),
      coordinator: new RunCoordinator(),
      events: new EventHub(),
      runAgent,
      store: {
        createHeartbeatRun: async (run) => runs.push(run),
        finishHeartbeatRun: async (id, update) =>
          Object.assign(runs.find((run) => run.id === id) as object, update),
        latestHeartbeatRun: async () => undefined,
        listHeartbeatRuns: async () => runs,
      },
      now: () => Date.now(),
    });

    await scheduler.start();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(runAgent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runAgent).toHaveBeenCalledOnce();
    expect(runs[0]).toMatchObject({ status: "quiet" });
    scheduler.stop();
    vi.useRealTimers();
  });

  test("marks an interrupted persisted run as failed on restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(30_000);
    const finishHeartbeatRun = vi.fn(async () => undefined);
    const scheduler = new HeartbeatScheduler({
      load: async () => parseHeartbeat("---\nevery: 1m\n---\nCheck"),
      coordinator: new RunCoordinator(),
      events: new EventHub(),
      runAgent: async () => "HEARTBEAT_OK",
      store: {
        createHeartbeatRun: async () => undefined,
        finishHeartbeatRun,
        latestHeartbeatRun: async () => ({
          id: "interrupted",
          startedAt: 10_000,
          status: "running",
        }),
        listHeartbeatRuns: async () => [],
      },
      now: () => Date.now(),
    });

    await scheduler.start();

    expect(finishHeartbeatRun).toHaveBeenCalledWith("interrupted", {
      finishedAt: 30_000,
      status: "error",
      error: "Heartbeat was interrupted by restart",
    });
    await scheduler.stop();
    vi.useRealTimers();
  });

  test("defers while chat is active without overlapping", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const coordinator = new RunCoordinator();
    let release: (() => void) | undefined;
    const chat = coordinator.run(
      "chat",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const runAgent = vi.fn(async () => "Needs attention");
    const scheduler = new HeartbeatScheduler({
      load: async () => parseHeartbeat("---\nevery: 1m\n---\nCheck"),
      coordinator,
      events: new EventHub(),
      runAgent,
      store: {
        createHeartbeatRun: async () => undefined,
        finishHeartbeatRun: async () => undefined,
        latestHeartbeatRun: async () => undefined,
        listHeartbeatRuns: async () => [],
      },
      now: () => Date.now(),
    });

    await scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runAgent).not.toHaveBeenCalled();
    release?.();
    await chat;
    await vi.advanceTimersByTimeAsync(0);
    expect(runAgent).toHaveBeenCalledOnce();
    scheduler.stop();
    vi.useRealTimers();
  });

  test("does not create an orphan run when run-now is busy", async () => {
    const coordinator = new RunCoordinator();
    let release: (() => void) | undefined;
    const chat = coordinator.run(
      "chat",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const createHeartbeatRun = vi.fn(async () => undefined);
    const scheduler = new HeartbeatScheduler({
      load: async () => parseHeartbeat("Check"),
      coordinator,
      events: new EventHub(),
      runAgent: async () => "HEARTBEAT_OK",
      store: {
        createHeartbeatRun,
        finishHeartbeatRun: async () => undefined,
        latestHeartbeatRun: async () => undefined,
        listHeartbeatRuns: async () => [],
      },
    });

    await expect(scheduler.runNow()).rejects.toThrow(/already running/i);
    expect(createHeartbeatRun).not.toHaveBeenCalled();
    release?.();
    await chat;
  });

  test("does not retry failures and classifies non-OK output as attention", async () => {
    const runs: HeartbeatRunRecord[] = [];
    const scheduler = new HeartbeatScheduler({
      load: async () => parseHeartbeat("Check"),
      coordinator: new RunCoordinator(),
      events: new EventHub(),
      runAgent: async () => "HEARTBEAT_OK\n",
      store: {
        createHeartbeatRun: async (run) => runs.push(run),
        finishHeartbeatRun: async (id, update) =>
          Object.assign(runs.find((run) => run.id === id) as object, update),
        latestHeartbeatRun: async () => undefined,
        listHeartbeatRuns: async () => runs,
      },
      now: () => 1_000,
    });

    await scheduler.runNow();
    expect(runs[0]).toMatchObject({
      status: "attention",
      summary: "HEARTBEAT_OK",
    });
  });
});
