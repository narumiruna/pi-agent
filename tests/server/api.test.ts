import { Hono } from "hono";
import { describe, expect, test, vi } from "vitest";
import { EventHub } from "../../src/server/agent/events.js";
import {
  type ApiEnv,
  type ApiServices,
  registerApi,
} from "../../src/server/api.js";

function appWith(overrides: Partial<ApiServices> = {}) {
  const app = new Hono<ApiEnv>();
  const services = {
    config: { agentDir: "/tmp/agent" },
    store: { listHeartbeatRuns: async () => [] },
    pi: {
      activeSession: { model: undefined, thinkingLevel: "off" },
      modelRuntime: { getProviders: () => [] },
      models: () => [],
      providerAccess: async () => [],
      providerLoginPending: false,
      events: { replayAfter: () => [], subscribe: () => () => undefined },
    },
    interactions: { replayPending: () => 0 },
    resources: {},
    mcp: { diagnostics: () => [] },
    heartbeat: {},
    ...overrides,
  } as unknown as ApiServices;
  registerApi(app, services);
  return app;
}

describe("API contracts", () => {
  test("replays pending interactions when an SSE client connects", async () => {
    const events = new EventHub();
    const replayPending = vi.fn((publish: (data: unknown) => void) => {
      publish({ id: "prompt-1", kind: "secret", title: "API key" });
      return 1;
    });
    const app = appWith({
      interactions: { replayPending } as never,
      pi: { events } as never,
    });
    const abort = new AbortController();

    const response = await app.request("/api/events", { signal: abort.signal });
    const reader = response.body?.getReader();
    let text = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const chunk = await reader?.read();
      text += new TextDecoder().decode(chunk?.value);
      if (text.includes("event: interaction")) break;
    }

    expect(replayPending).toHaveBeenCalledOnce();
    expect(text).toContain("event: interaction");
    expect(text).toContain('"id":"prompt-1"');
    expect(events.cursor).toBe(0);
    abort.abort();
    await reader?.cancel();
  });

  test("returns a model configuration error without exposing credential input", async () => {
    const app = appWith({
      pi: {
        setModel: vi.fn(async () => {
          throw new Error("No API key for anthropic/model");
        }),
      } as never,
    });

    const response = await app.request("/api/model", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "anthropic", modelId: "model" }),
    });

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("provider_not_configured");
    expect(body).not.toContain("API key");
  });

  test("does not expose custom model headers", async () => {
    const app = appWith({
      pi: {
        activeSession: { model: undefined, thinkingLevel: "off" },
        modelRuntime: { getProviders: () => [] },
        providerAccess: async () => [],
        providerLoginPending: false,
        models: () => [
          {
            id: "private",
            name: "Private",
            provider: "custom",
            api: "openai-completions",
            reasoning: false,
            input: ["text"],
            contextWindow: 1,
            maxTokens: 1,
            baseUrl: "https://models.example.com",
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            headers: { Authorization: "secret" },
          },
        ],
      } as never,
    });

    const body = await (await app.request("/api/models")).text();

    expect(body).not.toContain("secret");
    expect(body).not.toContain("Authorization");
    expect(JSON.parse(body).models[0]).toMatchObject({
      id: "private",
      provider: "custom",
    });
  });

  test("does not expose headers from the current model", async () => {
    const current = {
      id: "private",
      name: "Private",
      provider: "custom",
      reasoning: false,
      headers: { Authorization: "private-key" },
    };
    const app = appWith({
      pi: {
        activeSession: { model: current, thinkingLevel: "off" },
        models: () => [current],
        providerAccess: async () => [],
        providerLoginPending: false,
      } as never,
    });

    const body = await (await app.request("/api/models")).text();

    expect(body).not.toContain("private-key");
    expect(body).not.toContain("Authorization");
    expect(JSON.parse(body).current).toEqual({
      id: "private",
      name: "Private",
      provider: "custom",
    });
  });

  test("returns safe provider access metadata and supported thinking levels", async () => {
    const providerAccess = vi.fn(async () => [
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
          oauth: {
            name: "Anthropic (Claude Pro/Max)",
            loginLabel: "Sign in",
            subscription: true,
          },
        },
      },
    ]);
    const app = appWith({
      pi: {
        activeSession: {
          model: {
            provider: "anthropic",
            id: "reasoner",
            name: "Reasoner",
            reasoning: true,
            thinkingLevelMap: { xhigh: null, max: "max" },
          },
          thinkingLevel: "high",
        },
        models: () => [],
        providerAccess,
        providerLoginPending: false,
      } as never,
    });

    const response = await app.request("/api/models");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      thinkingLevels: ["off", "minimal", "low", "medium", "high", "max"],
      authPending: false,
      providers: [
        {
          id: "anthropic",
          status: { disconnectable: true },
          auth: { oauth: { subscription: true } },
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("private-key");
  });

  test("accepts an API key without returning or publishing the secret", async () => {
    const providerLogin = vi.fn(async () => undefined);
    const app = appWith({ pi: { providerLogin } as never });

    const response = await app.request("/api/providers/anthropic/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "api_key", apiKey: "private-key" }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("private-key");
    expect(providerLogin).toHaveBeenCalledWith(
      "anthropic",
      "api_key",
      "private-key",
    );
  });

  test("rejects an OAuth request that includes an API key", async () => {
    const providerLogin = vi.fn();
    const app = appWith({ pi: { providerLogin } as never });

    const response = await app.request("/api/providers/anthropic/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "oauth", apiKey: "private-key" }),
    });

    expect(response.status).toBe(400);
    expect(providerLogin).not.toHaveBeenCalled();
  });

  test("cancels the active authentication flow", async () => {
    const cancelProviderLogin = vi.fn();
    const app = appWith({ pi: { cancelProviderLogin } as never });

    const response = await app.request("/api/providers/login/cancel", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(cancelProviderLogin).toHaveBeenCalledOnce();
  });

  test("classifies an aborted provider login as cancellation", async () => {
    const app = appWith({
      pi: {
        providerLogin: vi.fn(async () => {
          throw new DOMException("Authentication cancelled", "AbortError");
        }),
      } as never,
    });

    const response = await app.request("/api/providers/anthropic/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "oauth" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "cancelled" } });
  });

  test("rejects concurrent provider logins as a conflict", async () => {
    const app = appWith({
      pi: {
        providerLogin: vi.fn(async () => {
          throw new Error("Provider authentication is already in progress");
        }),
      } as never,
    });

    const response = await app.request("/api/providers/openai/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "oauth" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "conflict" } });
  });

  test("establishes an SSE cursor and replays from it", async () => {
    const events = new EventHub();
    const first = events.publish("run_status", { status: "old" });
    const app = appWith({ pi: { events } as never });
    const initialAbort = new AbortController();
    const initial = await app.request("/api/events", {
      signal: initialAbort.signal,
    });
    const initialReader = initial.body?.getReader();
    const initialChunk = await initialReader?.read();
    const initialText = new TextDecoder().decode(initialChunk?.value);
    expect(initialText).toContain(`id: ${first.id}`);
    expect(initialText).toContain("event: ready");
    initialAbort.abort();
    await initialReader?.cancel();

    const second = events.publish("run_status", { status: "new" });
    const replayAbort = new AbortController();
    const replay = await app.request("/api/events", {
      headers: { "last-event-id": String(first.id) },
      signal: replayAbort.signal,
    });
    const replayReader = replay.body?.getReader();
    const replayChunk = await replayReader?.read();
    const replayText = new TextDecoder().decode(replayChunk?.value);
    expect(replayText).toContain(`id: ${second.id}`);
    expect(replayText).toContain('data: {"status":"new"}');
    replayAbort.abort();
    await replayReader?.cancel();
  });

  test("rejects unknown document kinds before touching the filesystem", async () => {
    const readDocument = vi.fn();
    const app = appWith({ resources: { readDocument } as never });

    const response = await app.request("/api/documents/unknown");

    expect(response.status).toBe(400);
    expect(readDocument).not.toHaveBeenCalled();
  });
});
