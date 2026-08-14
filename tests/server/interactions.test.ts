import { describe, expect, test, vi } from "vitest";
import { EventHub } from "../../src/server/agent/events.js";
import { InteractionBroker } from "../../src/server/interactions/broker.js";
import {
  createHeadlessTheme,
  createWebExtensionUi,
} from "../../src/server/interactions/ui.js";
import {
  sanitizeExtensionText,
  WebExtensionState,
} from "../../src/server/interactions/web-state.js";

describe("Web extension UI", () => {
  test("keeps keyed status and string widgets while stripping terminal control sequences", () => {
    const events = new EventHub();
    const state = new WebExtensionState(events);
    state.reset("session");

    state.setStatus("build", "\u001b[31mrunning\u001b[0m");
    state.setWidget(
      "todo",
      Array.from({ length: 30 }, (_, index) => `line ${index}`),
      "belowEditor",
    );

    expect(state.snapshot()).toMatchObject({
      statuses: [{ key: "build", text: "running" }],
      widgets: [
        { key: "todo", placement: "belowEditor", lines: expect.any(Array) },
      ],
    });
    expect(state.snapshot().widgets[0].lines).toHaveLength(20);
    state.setStatus("build", undefined);
    expect(state.snapshot().statuses).toEqual([]);
  });

  test("supports editor prefill and safely ignores component widgets", () => {
    const events = new EventHub();
    const state = new WebExtensionState(events);
    state.reset("session");
    const ui = createWebExtensionUi(
      new InteractionBroker(events),
      events,
      state,
      createHeadlessTheme(),
    );

    ui.setEditorText("one");
    ui.pasteToEditor(" two");
    ui.setWidget("component", (() => undefined) as never);

    expect(ui.getEditorText()).toBe("one two");
    state.setComposerFromClient("a".repeat(99_999));
    ui.pasteToEditor("overflow");
    expect(ui.getEditorText()).toHaveLength(100_000);
    expect(state.snapshot().widgets).toEqual([]);
  });

  test("bounds extension update frequency and sanitizes notifications", () => {
    const events = new EventHub();
    const state = new WebExtensionState(events);
    state.reset("session");
    const published: unknown[] = [];
    events.subscribe((event) => published.push(event));
    const ui = createWebExtensionUi(
      new InteractionBroker(events),
      events,
      state,
      createHeadlessTheme(),
    );

    for (let index = 0; index < 130; index += 1)
      state.setStatus("build", String(index));
    ui.notify("\u001b]0;bad\u0007Ready", "warning");

    expect(
      published.filter(
        (event) => (event as { type: string }).type === "extension_ui",
      ),
    ).toHaveLength(120);
    expect(published.at(-1)).toMatchObject({
      type: "notification",
      data: { message: "Ready", type: "warning" },
    });
  });

  test("removes ANSI, OSC, and C0 controls without damaging Unicode", () => {
    expect(
      sanitizeExtensionText("\u001b[32m綠色\u001b[0m\u009b31m\u0000\t文字"),
    ).toBe("綠色\t文字");
  });
});

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
