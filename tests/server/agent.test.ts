import type { AuthInteraction } from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import { EventHub } from "../../src/server/agent/events.js";
import { PiService } from "../../src/server/agent/pi-service.js";
import { RunCoordinator } from "../../src/server/agent/run-coordinator.js";
import { projectTranscript } from "../../src/server/agent/transcript.js";
import { InteractionBroker } from "../../src/server/interactions/broker.js";

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

  test("projects a recoverable Codex device-code task without credentials", async () => {
    let finishLogin: (() => void) | undefined;
    const prompt = vi.fn(async () => "device_code");
    const notify = vi.fn();
    const events = new EventHub();
    const published: unknown[] = [];
    events.subscribe((event) => {
      if (event.type === "provider_auth") published.push(event.data);
    });
    const login = vi.fn(
      async (_provider: string, _type: string, auth: AuthInteraction) => {
        expect(
          await auth.prompt({
            type: "select",
            message: "Select OpenAI Codex login method:",
            options: [
              { id: "browser", label: "Browser login" },
              { id: "device_code", label: "Device code login" },
            ],
          }),
        ).toBe("device_code");
        auth.notify({
          type: "device_code",
          userCode: "ABCD-1234",
          verificationUri: "https://auth.openai.com/codex/device",
          expiresInSeconds: 900,
        });
        await new Promise<void>((resolve) => {
          finishLogin = resolve;
        });
        return {
          type: "oauth" as const,
          access: "access-secret",
          refresh: "refresh-secret",
          expires: Date.now() + 3_600_000,
        };
      },
    );
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: events },
      modelRuntime: {
        value: {
          getProviders: () => [{ id: "openai-codex", name: "OpenAI Codex" }],
          login,
        },
      },
      interactions: {
        value: { prompt, notify, cancelAll: vi.fn() },
      },
    });

    const pending = service.providerLogin("openai-codex", "oauth");
    await vi.waitFor(() =>
      expect(service.providerAuthTask()).toMatchObject({
        providerId: "openai-codex",
        providerName: "OpenAI Codex",
        phase: "waiting",
        method: "device_code",
        userCode: "ABCD-1234",
        verificationUri: "https://auth.openai.com/codex/device",
      }),
    );
    expect(JSON.stringify(service.providerAuthTask())).not.toContain("secret");
    expect(published).not.toHaveLength(0);

    finishLogin?.();
    await pending;
    expect(service.providerAuthTask()).toEqual({
      providerId: "openai-codex",
      providerName: "OpenAI Codex",
      phase: "succeeded",
    });
    expect(notify).not.toHaveBeenCalled();
  });

  test("preserves the browser authorization URL across a manual-code prompt", async () => {
    let answerPrompt: ((value: string) => void) | undefined;
    const prompt = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          answerPrompt = resolve;
        }),
    );
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: new EventHub() },
      modelRuntime: {
        value: {
          getProviders: () => [{ id: "openai-codex", name: "OpenAI Codex" }],
          login: async (
            _provider: string,
            _type: string,
            auth: AuthInteraction,
          ) => {
            auth.notify({
              type: "auth_url",
              url: "https://auth.openai.com/oauth/authorize",
              instructions: "Complete login in your browser.",
            });
            await auth.prompt({
              type: "manual_code",
              message: "Paste the authorization code or redirect URL",
              placeholder: "http://localhost:1455/auth/callback",
            });
          },
        },
      },
      interactions: {
        value: { prompt, notify: vi.fn(), cancelAll: vi.fn() },
      },
    });

    const pending = service.providerLogin("openai-codex", "oauth");
    await vi.waitFor(() =>
      expect(service.providerAuthTask()).toMatchObject({
        phase: "waiting",
        method: "browser",
        message: "Paste the authorization code or redirect URL",
        url: "https://auth.openai.com/oauth/authorize",
      }),
    );

    answerPrompt?.("authorization-code");
    await pending;
  });

  test("keeps a safe terminal authentication state for failure and cancellation", async () => {
    const login = vi.fn(async () => {
      throw new Error("token exchange failed: access-secret");
    });
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: new EventHub() },
      modelRuntime: {
        value: {
          getProviders: () => [{ id: "openai-codex", name: "OpenAI Codex" }],
          login,
        },
      },
      interactions: {
        value: { prompt: vi.fn(), notify: vi.fn(), cancelAll: vi.fn() },
      },
    });

    await expect(
      service.providerLogin("openai-codex", "oauth"),
    ).rejects.toThrow();
    expect(service.providerAuthTask()).toMatchObject({
      phase: "failed",
      error: "login_failed",
    });
    expect(JSON.stringify(service.providerAuthTask())).not.toContain(
      "access-secret",
    );

    service.dismissProviderAuthTask();
    expect(service.providerAuthTask()).toBeUndefined();
  });

  test("keeps non-Codex OAuth device-code events provider neutral", async () => {
    let finishLogin: (() => void) | undefined;
    const events = new EventHub();
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: events },
      modelRuntime: {
        value: {
          getProviders: () => [{ id: "radius", name: "Radius" }],
          login: async (
            _provider: string,
            _type: string,
            auth: AuthInteraction,
          ) => {
            auth.notify({
              type: "device_code",
              userCode: "RADIUS-1",
              verificationUri: "https://radius.example/device",
            });
            await new Promise<void>((resolve) => {
              finishLogin = resolve;
            });
          },
        },
      },
      interactions: {
        value: { prompt: vi.fn(), notify: vi.fn(), cancelAll: vi.fn() },
      },
    });

    const pending = service.providerLogin("radius", "oauth");
    await vi.waitFor(() =>
      expect(service.providerAuthTask()).toMatchObject({
        providerId: "radius",
        userCode: "RADIUS-1",
        verificationUri: "https://radius.example/device",
      }),
    );
    finishLogin?.();
    await pending;
  });

  test("does not overwrite a completed OAuth task when an API-key login fails", async () => {
    const login = vi.fn(async (_provider: string, type: string) => {
      if (type === "api_key") throw new Error("Invalid API key");
    });
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: new EventHub() },
      modelRuntime: {
        value: {
          getProviders: () => [
            { id: "openai-codex", name: "OpenAI Codex" },
            { id: "anthropic", name: "Anthropic" },
          ],
          login,
        },
      },
      interactions: {
        value: { prompt: vi.fn(), notify: vi.fn(), cancelAll: vi.fn() },
      },
    });

    await service.providerLogin("openai-codex", "oauth");
    const completedTask = service.providerAuthTask();
    await expect(
      service.providerLogin("anthropic", "api_key", "invalid-key"),
    ).rejects.toThrow("Invalid API key");

    expect(service.providerAuthTask()).toEqual(completedTask);
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

  test("cancels provider authentication without dismissing extension input", async () => {
    const events = new EventHub();
    const interactions = new InteractionBroker(events);
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: events },
      modelRuntime: {
        value: {
          getProviders: () => [{ id: "openai-codex", name: "OpenAI Codex" }],
          login: async (
            _provider: string,
            _type: string,
            auth: AuthInteraction,
          ) => {
            await auth.prompt({
              type: "text",
              message: "Provider authorization code",
            });
          },
        },
      },
      interactions: { value: interactions },
    });

    const extensionInput = interactions.request("input", {
      title: "Extension input",
    });
    const providerLogin = service.providerLogin("openai-codex", "oauth");
    await vi.waitFor(() => expect(interactions.pendingCount).toBe(2));

    const cancellation = service.cancelProviderLogin();
    await expect(providerLogin).rejects.toMatchObject({ name: "AbortError" });
    await cancellation;
    expect(interactions.pendingCount).toBe(1);

    const replayed: Array<{ id: string; title?: string }> = [];
    interactions.replayPending((data) =>
      replayed.push(data as { id: string; title?: string }),
    );
    expect(replayed).toEqual([
      expect.objectContaining({ title: "Extension input" }),
    ]);
    interactions.respond(replayed[0].id, "keep-running");
    await expect(extensionInput).resolves.toBe("keep-running");
  });

  test("waits for provider cleanup before cancellation completes", async () => {
    let finishLogin: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: new EventHub() },
      modelRuntime: {
        value: {
          getProviders: () => [{ id: "openai-codex", name: "OpenAI Codex" }],
          login: async (
            _provider: string,
            _type: string,
            auth: AuthInteraction,
          ) => {
            signal = auth.signal;
            await new Promise<void>((resolve) => {
              finishLogin = resolve;
            });
            if (auth.signal?.aborted) throw auth.signal.reason;
          },
        },
      },
      interactions: {
        value: { prompt: vi.fn(), notify: vi.fn(), cancelAll: vi.fn() },
      },
    });

    const login = service.providerLogin("openai-codex", "oauth");
    await vi.waitFor(() => expect(signal).toBeDefined());
    let cancellationFinished = false;
    const cancellation = Promise.resolve(service.cancelProviderLogin()).then(
      () => {
        cancellationFinished = true;
      },
    );

    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    await Promise.resolve();
    expect(cancellationFinished).toBe(false);

    finishLogin?.();
    await expect(login).rejects.toMatchObject({ name: "AbortError" });
    await cancellation;
    expect(service.providerLoginPending).toBe(false);
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
      events: { value: new EventHub() },
      modelRuntime: {
        value: {
          getProviders: () => [{ id: "anthropic", name: "Anthropic" }],
          login,
        },
      },
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
    expect(cancelAll).not.toHaveBeenCalled();
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
