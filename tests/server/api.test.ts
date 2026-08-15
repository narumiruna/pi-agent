import { Hono } from "hono";
import { describe, expect, test, vi } from "vitest";
import { EventHub } from "../../src/server/agent/events.js";
import {
  type ApiEnv,
  type ApiServices,
  registerApi,
} from "../../src/server/api.js";
import { WorkspaceError } from "../../src/server/workspace/errors.js";

function appWith(overrides: Partial<ApiServices> = {}) {
  const app = new Hono<ApiEnv>();
  const pi = {
    activeSession: { model: undefined, thinkingLevel: "off" },
    modelRuntime: { getProviders: () => [] },
    models: () => [],
    preferences: () => ({
      steeringMode: "all",
      followUpMode: "all",
      autoCompaction: true,
      autoRetry: true,
      activeTools: ["read"],
      availableTools: [{ name: "read", description: "Read files" }],
    }),
    providerAccess: async () => [],
    providerAuthTask: () => undefined,
    providerLoginPending: false,
    events: { replayAfter: () => [], subscribe: () => () => undefined },
    ...overrides.pi,
  };
  const services = {
    config: {
      agentDir: "/tmp/agent",
      dataDir: "/tmp/data",
      workspace: "/tmp",
    },
    store: { listHeartbeatRuns: async () => [] },
    interactions: { replayPending: () => 0 },
    resources: {},
    workspace: {},
    mcp: { diagnostics: () => [] },
    heartbeat: {},
    ...overrides,
    pi,
  } as unknown as ApiServices;
  registerApi(app, services);
  return app;
}

describe("API contracts", () => {
  test("accepts an image-only conversation message", async () => {
    const prompt = vi.fn(async () => "run-1");
    const app = appWith({ pi: { prompt } as never });
    const image = {
      type: "image",
      data: "aW1hZ2U=",
      mimeType: "image/png",
    };

    const response = await app.request("/api/conversations/session/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "", images: [image] }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ runId: "run-1" });
    expect(prompt).toHaveBeenCalledWith("session", "", [image]);
  });

  test("enriches older heartbeat runs with native session diagnostics", async () => {
    const heartbeatRunDetails = vi.fn(() => ({
      response: "Weather lookup failed",
      tools: [{ id: "tool-1", name: "bash", output: "timeout", isError: true }],
    }));
    const app = appWith({
      pi: { heartbeatRunDetails } as never,
      heartbeat: { status: () => ({ enabled: true }) } as never,
      store: {
        listHeartbeatRuns: async () => [
          {
            id: "run",
            startedAt: 10,
            finishedAt: 20,
            status: "attention" as const,
            summary: "Needs review",
          },
        ],
      } as never,
    });

    const response = await app.request("/api/heartbeat");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      runs: [
        {
          id: "run",
          details: {
            response: "Weather lookup failed",
            tools: [{ output: "timeout" }],
          },
        },
      ],
    });
    expect(heartbeatRunDetails).toHaveBeenCalledWith(10, 20);
  });

  test("queues steering input for an active conversation run", async () => {
    const steer = vi.fn(async () => undefined);
    const app = appWith({ pi: { steer } as never });

    const response = await app.request("/api/conversations/session/steer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Change direction" }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ queued: true });
    expect(steer).toHaveBeenCalledWith(
      "session",
      "Change direction",
      undefined,
    );
  });

  test("queues follow-up input for an active conversation run", async () => {
    const followUp = vi.fn(async () => undefined);
    const app = appWith({ pi: { followUp } as never });

    const response = await app.request("/api/conversations/session/follow-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Run tests next" }),
    });

    expect(response.status).toBe(202);
    expect(followUp).toHaveBeenCalledWith(
      "session",
      "Run tests next",
      undefined,
    );
  });

  test("returns native conversation state without server paths", async () => {
    const conversationState = vi.fn(() => ({
      sessionId: "session",
      running: false,
      queue: { sessionId: "session", steering: [], followUp: [] },
      preferences: {
        steeringMode: "all",
        followUpMode: "all",
        autoCompaction: true,
        autoRetry: true,
        activeTools: ["read"],
        availableTools: [{ name: "read", description: "Read" }],
      },
      stats: {
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 2,
        tokens: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          total: 2,
        },
        cost: 0,
      },
      tree: [],
      leafId: null,
      treeTruncated: false,
      extensionUi: {
        sessionId: "session",
        statuses: [],
        widgets: [],
        editorText: "",
        workingVisible: true,
        toolsExpanded: false,
      },
    }));
    const app = appWith({ pi: { conversationState } as never });

    const response = await app.request("/api/conversations/session/state");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("/tmp/");
    expect(JSON.parse(body)).toMatchObject({ sessionId: "session" });
  });

  test("updates native agent settings", async () => {
    const setPreferences = vi.fn(() => ({ steeringMode: "one-at-a-time" }));
    const app = appWith({ pi: { setPreferences } as never });

    const response = await app.request("/api/agent-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ steeringMode: "one-at-a-time" }),
    });

    expect(response.status).toBe(200);
    expect(setPreferences).toHaveBeenCalledWith({
      steeringMode: "one-at-a-time",
    });
  });

  test("exports with a safe attachment name and no server path", async () => {
    const exportConversation = vi.fn(async () => ({
      content: Buffer.from("session"),
      contentType: "application/x-ndjson; charset=utf-8",
      fileName: "conversation-session.jsonl",
    }));
    const app = appWith({ pi: { exportConversation } as never });

    const response = await app.request(
      "/api/conversations/session/export/jsonl",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="conversation-session.jsonl"',
    );
    expect(response.headers.get("content-disposition")).not.toContain("/tmp");
    expect(await response.text()).toBe("session");
  });

  test("imports JSONL content without accepting a server path", async () => {
    const importConversation = vi.fn(async () => "imported");
    const app = appWith({ pi: { importConversation } as never });

    const response = await app.request("/api/conversations/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content:
          '{"type":"session","version":3,"id":"imported","timestamp":"2026-01-01T00:00:00Z","cwd":"/hidden"}\n',
      }),
    });

    expect(response.status).toBe(201);
    expect(importConversation).toHaveBeenCalledWith(
      expect.stringContaining("imported"),
    );
    expect(await response.json()).toEqual({ id: "imported" });
  });

  test("uses native tree, fork, and compaction operations", async () => {
    const navigateConversationTree = vi.fn(async () => ({ cancelled: false }));
    const forkConversation = vi.fn(async () => ({ id: "forked" }));
    const compactConversation = vi.fn(async () => ({
      summary: "summary",
      tokensBefore: 100,
    }));
    const app = appWith({
      pi: {
        navigateConversationTree,
        forkConversation,
        compactConversation,
      } as never,
    });

    const navigation = await app.request(
      "/api/conversations/session/tree/navigate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId: "entry" }),
      },
    );
    const fork = await app.request("/api/conversations/session/fork", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetId: "entry", position: "at" }),
    });
    const compact = await app.request("/api/conversations/session/compact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(navigation.status).toBe(200);
    expect(fork.status).toBe(201);
    expect(compact.status).toBe(200);
    expect(navigateConversationTree).toHaveBeenCalledWith(
      "session",
      "entry",
      {},
    );
    expect(forkConversation).toHaveBeenCalledWith("session", "entry", "at");
    expect(compactConversation).toHaveBeenCalledWith("session", undefined);
  });

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
        providerAuthTask: () => undefined,
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
        providerAuthTask: () => undefined,
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
        providerAuthTask: () => undefined,
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

  test("returns a recoverable provider-auth task without credential secrets", async () => {
    const app = appWith({
      pi: {
        providerAuthTask: () => ({
          providerId: "openai-codex",
          providerName: "OpenAI Codex",
          phase: "waiting",
          method: "device_code",
          userCode: "ABCD-1234",
          verificationUri: "https://auth.openai.com/codex/device",
          expiresAt: Date.now() + 900_000,
        }),
      } as never,
    });

    const response = await app.request("/api/provider-auth");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({
      providerId: "openai-codex",
      phase: "waiting",
      userCode: "ABCD-1234",
    });
    expect(body).not.toContain("access-secret");
    expect(body).not.toContain("refresh-secret");
  });

  test("dismisses a terminal provider-auth task", async () => {
    const dismissProviderAuthTask = vi.fn();
    const app = appWith({ pi: { dismissProviderAuthTask } as never });

    const response = await app.request("/api/provider-auth", {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(dismissProviderAuthTask).toHaveBeenCalledOnce();
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

  test("waits for the active authentication flow to stop before confirming cancellation", async () => {
    let finishCancellation: (() => void) | undefined;
    const cancelProviderLogin = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCancellation = resolve;
        }),
    );
    const app = appWith({ pi: { cancelProviderLogin } as never });

    let responseSettled = false;
    const pendingResponse = Promise.resolve(
      app.request("/api/providers/login/cancel", { method: "POST" }),
    ).then((response) => {
      responseSettled = true;
      return response;
    });
    await vi.waitFor(() => expect(cancelProviderLogin).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(responseSettled).toBe(false);

    finishCancellation?.();
    const response = await pendingResponse;
    expect(response.status).toBe(200);
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

  test("lists and inspects workspace files through relative contracts", async () => {
    const listDirectory = vi.fn(async () => ({
      path: "src",
      entries: [
        {
          path: "src/index.ts",
          name: "index.ts",
          kind: "file",
          modifiedAt: 1,
          size: 2,
        },
      ],
      truncated: false,
      writable: true,
    }));
    const inspectFile = vi.fn(async () => ({
      path: "src/index.ts",
      name: "index.ts",
      kind: "file",
      modifiedAt: 1,
      size: 2,
      revision: "revision",
      editable: true,
      writable: true,
      content: "ok",
    }));
    const app = appWith({
      workspace: { listDirectory, inspectFile } as never,
    });

    const listing = await app.request("/api/workspace/entries?path=src");
    const file = await app.request("/api/workspace/file?path=src%2Findex.ts");

    expect(listing.status).toBe(200);
    expect(file.status).toBe(200);
    expect(listDirectory).toHaveBeenCalledWith("src", expect.any(AbortSignal));
    expect(inspectFile).toHaveBeenCalledWith(
      "src/index.ts",
      expect.any(AbortSignal),
    );
    expect(await file.text()).not.toContain("/tmp/");
  });

  test("validates workspace queries and mutation bodies", async () => {
    const writeFile = vi.fn(async () => ({ path: "file.txt" }));
    const renameFile = vi.fn(async () => ({ path: "renamed.txt" }));
    const deleteFile = vi.fn(async () => undefined);
    const app = appWith({
      workspace: { writeFile, renameFile, deleteFile } as never,
    });

    const missingPath = await app.request("/api/workspace/file");
    const extraQuery = await app.request(
      "/api/workspace/entries?path=src&absolute=/tmp/private",
    );
    const invalidLimit = await app.request(
      "/api/workspace/files?q=file&limit=invalid",
    );
    const oversizedPath = await app.request(
      `/api/workspace/entries?path=${"x".repeat(1_025)}`,
    );
    const invalidRevision = await app.request("/api/workspace/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "file.txt",
        content: "ok",
        revision: "",
      }),
    });
    const unknownField = await app.request("/api/workspace/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "file.txt",
        content: "ok",
        absolute: "/tmp/private",
      }),
    });
    const create = await app.request("/api/workspace/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "file.txt", content: "ok" }),
    });
    const update = await app.request("/api/workspace/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "file.txt",
        content: "updated",
        revision: "revision",
      }),
    });
    const rename = await app.request("/api/workspace/file", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "file.txt",
        name: "renamed.txt",
        revision: "revision",
      }),
    });
    const deleted = await app.request("/api/workspace/file", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "renamed.txt", revision: "revision-2" }),
    });

    expect(missingPath.status).toBe(400);
    expect(extraQuery.status).toBe(400);
    expect(invalidLimit.status).toBe(400);
    expect(oversizedPath.status).toBe(400);
    expect(invalidRevision.status).toBe(400);
    expect(unknownField.status).toBe(400);
    expect(create.status).toBe(201);
    expect(update.status).toBe(200);
    expect(rename.status).toBe(200);
    expect(deleted.status).toBe(204);
    expect(writeFile).toHaveBeenNthCalledWith(1, {
      path: "file.txt",
      content: "ok",
    });
    expect(writeFile).toHaveBeenNthCalledWith(2, {
      path: "file.txt",
      content: "updated",
      revision: "revision",
    });
    expect(renameFile).toHaveBeenCalledWith({
      path: "file.txt",
      name: "renamed.txt",
      revision: "revision",
    });
    expect(deleteFile).toHaveBeenCalledWith({
      path: "renamed.txt",
      revision: "revision-2",
    });
  });

  test.each([
    [400, "invalid_path", 400, "bad_request"],
    [403, "read_only", 403, "forbidden"],
    [404, "not_found", 404, "not_found"],
    [409, "stale", 409, "conflict"],
    [413, "too_large", 413, "bad_request"],
    [415, "binary", 415, "bad_request"],
  ] as const)(
    "maps workspace failure %s/%s without filesystem details",
    async (serviceStatus, reason, responseStatus, code) => {
      const app = appWith({
        workspace: {
          inspectFile: vi.fn(async () => {
            throw new WorkspaceError(serviceStatus, reason);
          }),
        } as never,
      });

      const response = await app.request(
        "/api/workspace/file?path=private.txt",
      );
      const body = await response.text();

      expect(response.status).toBe(responseStatus);
      expect(JSON.parse(body)).toEqual({
        error: { code, params: { reason } },
      });
      expect(body).not.toContain("/tmp/");
    },
  );

  test("streams workspace downloads with injection-safe attachment headers", async () => {
    const bytes = new TextEncoder().encode("download");
    const app = appWith({
      workspace: {
        downloadFile: vi.fn(async () => ({
          name: 'quo"te\n繁體.txt',
          size: bytes.length,
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        })),
      } as never,
    });

    const response = await app.request(
      "/api/workspace/download?path=nested%2Ffile.txt",
    );
    const disposition = response.headers.get("content-disposition") ?? "";

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).not.toContain("\n");
    expect(disposition).not.toContain("nested/");
    expect(await response.text()).toBe("download");
  });

  test("rejects unknown document kinds before touching the filesystem", async () => {
    const readDocument = vi.fn();
    const app = appWith({ resources: { readDocument } as never });

    const response = await app.request("/api/documents/unknown");

    expect(response.status).toBe(400);
    expect(readDocument).not.toHaveBeenCalled();
  });
});
