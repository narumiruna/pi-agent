import type { AuthInteraction } from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import { EventHub } from "../../src/server/agent/events.js";
import { PiService } from "../../src/server/agent/pi-service.js";
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

describe("model selection", () => {
  test("only exposes models with configured authentication", () => {
    const available = { provider: "anthropic", id: "available" };
    const unavailable = { provider: "openai", id: "unavailable" };
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperty(service, "modelRuntime", {
      value: {
        getAvailableSnapshot: () => [available],
        getModels: () => [available, unavailable],
      },
    });

    expect(service.models()).toEqual([available]);
  });

  test("does not change the chat model when the heartbeat update fails", async () => {
    const oldModel = { provider: "anthropic", id: "old" };
    const newModel = { provider: "anthropic", id: "new" };
    const chatSetModel = vi.fn(async () => undefined);
    const heartbeatSetModel = vi.fn(async () => {
      throw new Error("heartbeat failed");
    });
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      modelRuntime: { value: { getModel: () => newModel } },
      runtime: {
        value: { session: { model: oldModel, setModel: chatSetModel } },
      },
      heartbeatSession: {
        value: { model: oldModel, setModel: heartbeatSetModel },
      },
    });

    await expect(service.setModel("anthropic", "new")).rejects.toThrow(
      /heartbeat failed/,
    );
    expect(chatSetModel).not.toHaveBeenCalled();
  });

  test("restores the heartbeat model when the chat update fails", async () => {
    const oldModel = { provider: "anthropic", id: "old" };
    const newModel = { provider: "anthropic", id: "new" };
    const heartbeatSetModel = vi.fn(async () => undefined);
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      modelRuntime: { value: { getModel: () => newModel } },
      runtime: {
        value: {
          session: {
            model: oldModel,
            setModel: vi.fn(async () => {
              throw new Error("chat failed");
            }),
          },
        },
      },
      heartbeatSession: {
        value: { model: oldModel, setModel: heartbeatSetModel },
      },
    });

    await expect(service.setModel("anthropic", "new")).rejects.toThrow(
      /chat failed/,
    );
    expect(heartbeatSetModel).toHaveBeenNthCalledWith(1, newModel);
    expect(heartbeatSetModel).toHaveBeenNthCalledWith(2, oldModel);
  });
});

describe("provider access", () => {
  test("reports subscription methods and only allows stored credentials to be removed", async () => {
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperty(service, "modelRuntime", {
      value: {
        getProviders: () => [
          {
            id: "anthropic",
            name: "Anthropic",
            auth: {
              apiKey: { name: "Anthropic API key", login: vi.fn() },
              oauth: {
                name: "Anthropic (Claude Pro/Max)",
                loginLabel: "Sign in with Claude",
                isSubscription: true,
              },
            },
          },
          {
            id: "openai",
            name: "OpenAI",
            auth: { apiKey: { name: "OpenAI API key", login: vi.fn() } },
          },
        ],
        isUsingOAuth: (id: string) => id === "anthropic",
        getProviderAuthStatus: (id: string) =>
          id === "anthropic"
            ? { configured: true, source: "stored" }
            : {
                configured: true,
                source: "environment",
                label: "OPENAI_API_KEY",
              },
        listCredentials: async () => [
          { providerId: "anthropic", type: "oauth" },
        ],
      },
    });

    await expect(service.providerAccess()).resolves.toEqual([
      {
        id: "anthropic",
        name: "Anthropic",
        status: {
          configured: true,
          source: "stored",
          credentialType: "oauth",
          disconnectable: true,
        },
        auth: {
          apiKey: { name: "Anthropic API key" },
          oauth: {
            name: "Anthropic (Claude Pro/Max)",
            loginLabel: "Sign in with Claude",
            subscription: true,
          },
        },
      },
      {
        id: "openai",
        name: "OpenAI",
        status: {
          configured: true,
          source: "environment",
          label: "OPENAI_API_KEY",
          credentialType: "api_key",
          disconnectable: false,
        },
        auth: { apiKey: { name: "OpenAI API key" } },
      },
    ]);
  });

  test("uses a submitted API key for the first secret prompt without publishing it", async () => {
    const prompt = vi.fn();
    const login = vi.fn(
      async (_provider: string, _type: string, auth: AuthInteraction) => {
        const key = await auth.prompt({ type: "secret", message: "API key" });
        expect(key).toBe("private-key");
      },
    );
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      modelRuntime: { value: { login } },
      interactions: { value: { prompt, notify: vi.fn(), cancelAll: vi.fn() } },
    });

    await service.providerLogin("anthropic", "api_key", "private-key");

    expect(prompt).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalledOnce();
  });

  test("falls back to Pi prompts after consuming a submitted API key", async () => {
    const prompt = vi.fn(async () => "account-id");
    const login = vi.fn(
      async (_provider: string, _type: string, auth: AuthInteraction) => {
        expect(await auth.prompt({ type: "secret", message: "API key" })).toBe(
          "private-key",
        );
        expect(await auth.prompt({ type: "text", message: "Account ID" })).toBe(
          "account-id",
        );
      },
    );
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      modelRuntime: { value: { login } },
      interactions: {
        value: { prompt, notify: vi.fn(), cancelAll: vi.fn() },
      },
    });

    await service.providerLogin("cloudflare", "api_key", "private-key");

    expect(prompt).toHaveBeenCalledOnce();
  });

  test("refuses to remove externally managed credentials", async () => {
    const logout = vi.fn();
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperty(service, "modelRuntime", {
      value: { listCredentials: async () => [], logout },
    });

    await expect(service.providerLogout("openai")).rejects.toThrow(
      /not found/i,
    );
    expect(logout).not.toHaveBeenCalled();
  });

  test("serializes authentication and releases the flow after cancellation", async () => {
    let signal: AbortSignal | undefined;
    const login = vi.fn(
      async (_provider: string, _type: string, auth: AuthInteraction) => {
        signal = auth.signal;
        await new Promise<void>((_resolve, reject) => {
          auth.signal?.addEventListener(
            "abort",
            () => reject(auth.signal?.reason),
            { once: true },
          );
        });
      },
    );
    const cancelAll = vi.fn();
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      modelRuntime: { value: { login } },
      interactions: {
        value: { prompt: vi.fn(), notify: vi.fn(), cancelAll },
      },
    });

    const first = service.providerLogin("anthropic", "oauth");
    await vi.waitFor(() => expect(signal).toBeDefined());
    await expect(
      service.providerLogin("openai", "api_key", "key"),
    ).rejects.toThrow(/already in progress/i);

    service.cancelProviderLogin();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelAll).toHaveBeenCalledOnce();
    expect(service.providerLoginPending).toBe(false);
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
