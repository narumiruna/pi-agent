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
      events: { replayAfter: () => [], subscribe: () => () => undefined },
    },
    interactions: {},
    resources: {},
    mcp: { diagnostics: () => [] },
    heartbeat: {},
    ...overrides,
  } as unknown as ApiServices;
  registerApi(app, services);
  return app;
}

describe("API contracts", () => {
  test("does not expose custom model headers", async () => {
    const app = appWith({
      pi: {
        activeSession: { model: undefined, thinkingLevel: "off" },
        modelRuntime: { getProviders: () => [] },
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
