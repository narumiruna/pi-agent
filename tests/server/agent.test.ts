import { describe, expect, test, vi } from "vitest";
import { EventHub } from "../../src/server/agent/events.js";
import { RunCoordinator } from "../../src/server/agent/run-coordinator.js";
import { projectTranscript } from "../../src/server/agent/transcript.js";

describe("RunCoordinator", () => {
  test("allows exactly one run and becomes reusable after failure", async () => {
    const coordinator = new RunCoordinator();
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = coordinator.run("chat", () => pending);
    await expect(
      coordinator.run("heartbeat", async () => undefined),
    ).rejects.toMatchObject({ code: "agent_busy" });
    release?.();
    await first;
    await expect(
      coordinator.run("chat", async () => undefined),
    ).resolves.toBeUndefined();
  });

  test("aborts the current run through its registered abort function", async () => {
    const abort = vi.fn(async () => undefined);
    const coordinator = new RunCoordinator();
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = coordinator.run("chat", () => pending, abort);

    await coordinator.abort();
    expect(abort).toHaveBeenCalledOnce();
    release?.();
    await run;
  });
});

describe("EventHub", () => {
  test("replays events after an id and bounds retained history", () => {
    const hub = new EventHub(2);
    expect(hub.cursor).toBe(0);
    const one = hub.publish("run_status", { status: "one" });
    const two = hub.publish("run_status", { status: "two" });
    const three = hub.publish("run_status", { status: "three" });

    expect(hub.cursor).toBe(three.id);
    expect(hub.replayAfter(one.id).map((event) => event.data)).toEqual([
      { status: "two" },
      { status: "three" },
    ]);
    expect(hub.replayAfter(two.id).map((event) => event.data)).toEqual([
      { status: "three" },
    ]);
    expect(hub.replayAfter(three.id)).toEqual([]);
  });

  test("marks a stale cursor so clients refresh the transcript", () => {
    const hub = new EventHub(1);
    const old = hub.publish("run_status", { status: "old" });
    hub.publish("run_status", { status: "new" });

    expect(hub.replayAfter(old.id - 1)).toBeUndefined();
  });
});

describe("transcript projection", () => {
  test("keeps semantic message and tool content without exposing thinking", () => {
    const transcript = projectTranscript([
      { role: "user", content: "Hello", timestamp: 1 },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "secret" },
          { type: "text", text: "Hi" },
          {
            type: "toolCall",
            id: "call-1",
            name: "read",
            arguments: { path: "README.md" },
          },
        ],
        api: "test",
        provider: "test",
        model: "test",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 2,
      },
    ]);

    expect(JSON.stringify(transcript)).not.toContain("secret");
    expect(transcript).toMatchObject([
      { role: "user", text: "Hello" },
      {
        role: "assistant",
        text: "Hi",
        tools: [{ id: "call-1", name: "read" }],
      },
    ]);
  });
});
