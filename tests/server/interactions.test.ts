import { describe, expect, test, vi } from "vitest";
import { EventHub } from "../../src/server/agent/events.js";
import { InteractionBroker } from "../../src/server/interactions/broker.js";

describe("InteractionBroker", () => {
  test("publishes a request and resolves a matching response", async () => {
    const events = new EventHub();
    const broker = new InteractionBroker(events);
    let requestId: string | undefined;
    events.subscribe((event) => {
      if (event.type === "interaction")
        requestId = (event.data as { id: string }).id;
    });

    const pending = broker.request("input", { title: "Name" });
    expect(requestId).toBeDefined();
    expect(broker.respond(requestId as string, "Ada")).toBe(true);
    await expect(pending).resolves.toBe("Ada");
  });

  test("times out, removes, and dismisses unanswered requests", async () => {
    vi.useFakeTimers();
    const events = new EventHub();
    const kinds: string[] = [];
    events.subscribe((event) =>
      kinds.push((event.data as { kind: string }).kind),
    );
    const broker = new InteractionBroker(events);
    const pending = broker.request(
      "confirm",
      { title: "Continue" },
      { timeout: 10 },
    );

    await vi.advanceTimersByTimeAsync(11);
    await expect(pending).resolves.toBeUndefined();
    expect(broker.pendingCount).toBe(0);
    expect(kinds).toEqual(["confirm", "dismiss"]);
    vi.useRealTimers();
  });

  test("resolves without publishing when the request signal is already aborted", async () => {
    const events = new EventHub();
    const published = vi.fn();
    events.subscribe(published);
    const broker = new InteractionBroker(events);
    const controller = new AbortController();
    controller.abort();

    await expect(
      broker.request("input", { title: "Name" }, { signal: controller.signal }),
    ).resolves.toBeUndefined();
    expect(broker.pendingCount).toBe(0);
    expect(published).not.toHaveBeenCalled();
  });

  test("classifies a cancelled authentication prompt without retaining it", async () => {
    const events = new EventHub();
    const broker = new InteractionBroker(events);
    const prompt = broker.prompt({ type: "text", message: "Code" });
    const replayed: unknown[] = [];
    broker.replayPending((data) => replayed.push(data));

    broker.respond((replayed[0] as { id: string }).id);

    await expect(prompt).rejects.toMatchObject({ name: "AbortError" });
    expect(broker.pendingCount).toBe(0);
  });

  test("marks provider authentication prompts for dedicated Web routing", async () => {
    const events = new EventHub();
    const broker = new InteractionBroker(events);
    const published: unknown[] = [];
    events.subscribe((event) => published.push(event.data));

    const pending = broker.prompt(
      {
        type: "select",
        message: "Select login method",
        options: [{ id: "device_code", label: "Device code" }],
      },
      "provider_auth",
    );

    expect(published[0]).toMatchObject({
      kind: "select",
      scope: "provider_auth",
      title: "Select login method",
    });
    const id = (published[0] as { id: string }).id;
    broker.respond(id, "device_code");
    await expect(pending).resolves.toBe("device_code");
  });

  test("replays the active request for clients that connect after it starts", async () => {
    const events = new EventHub();
    const broker = new InteractionBroker(events);
    const pending = broker.request("secret", { title: "API key" });

    const replayed: unknown[] = [];
    expect(broker.replayPending((data) => replayed.push(data))).toBe(1);
    expect(replayed).toEqual([
      expect.objectContaining({ kind: "secret", title: "API key" }),
    ]);

    const id = (replayed[0] as { id: string }).id;
    broker.respond(id, "sk-secret");
    await pending;
  });

  test("does not expose secret responses in events", async () => {
    const events = new EventHub();
    const broker = new InteractionBroker(events);
    const published: unknown[] = [];
    events.subscribe((event) => published.push(event.data));

    const pending = broker.request("secret", { title: "API key" });
    const id = (published[0] as { id: string }).id;
    broker.respond(id, "sk-secret");
    await pending;

    expect(JSON.stringify(published)).not.toContain("sk-secret");
  });
});
