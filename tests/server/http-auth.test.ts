import { describe, expect, test, vi } from "vitest";
import { createApp } from "../../src/server/app.js";
import type { AppConfig } from "../../src/server/config.js";
import type {
  AppStore,
  WebSessionRecord,
} from "../../src/server/storage/types.js";

class Store implements AppStore {
  owner?: {
    issuer: string;
    subject: string;
    email?: string;
    claimedAt: number;
  };
  sessions = new Map<string, WebSessionRecord>();
  async migrate() {}
  async claimOwner(owner: NonNullable<Store["owner"]>) {
    this.owner ??= owner;
    return this.owner;
  }
  async getOwner() {
    return this.owner;
  }
  async createWebSession(session: WebSessionRecord) {
    this.sessions.set(session.tokenHash, session);
  }
  async findWebSession(tokenHash: string) {
    return this.sessions.get(tokenHash);
  }
  async deleteWebSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
  async deleteExpiredWebSessions() {
    return 0;
  }
  async createHeartbeatRun() {}
  async finishHeartbeatRun() {}
  async latestHeartbeatRun() {
    return undefined;
  }
  async listHeartbeatRuns() {
    return [];
  }
  async close() {}
}

const disabledConfig: AppConfig = {
  host: "127.0.0.1",
  port: 3000,
  appOrigin: "http://localhost:3000",
  agentDir: "/tmp/agent",
  dataDir: "/tmp/data",
  workspace: "/tmp/workspace",
  sqlitePath: "/tmp/data/app.db",
  agentTools: ["read"],
  auth: { mode: "disabled" },
};

function apiServices(workspace: object, piOverrides: object = {}) {
  return {
    pi: {
      activeSession: { model: undefined, thinkingLevel: "off" },
      commands: () => [],
      diagnostics: () => ({}),
      models: () => [],
      preferences: () => ({
        steeringMode: "all",
        followUpMode: "all",
        autoCompaction: true,
        autoRetry: true,
        activeTools: ["read"],
        availableTools: [],
      }),
      providerAccess: async () => [],
      providerAuthTask: () => undefined,
      providerLoginPending: false,
      ...piOverrides,
    },
    interactions: { replayPending: () => 0 },
    resources: {},
    workspace,
    mcp: { diagnostics: () => [] },
    heartbeat: {},
  } as never;
}

describe("HTTP authentication boundary", () => {
  test("keeps health endpoints public and protects the API", async () => {
    const app = createApp({
      config: { ...disabledConfig, auth: { mode: "oidc" } as never },
      store: new Store(),
    });

    expect((await app.request("/health/live")).status).toBe(200);
    expect((await app.request("/api/session")).status).toBe(401);
  });

  test("shows a warning when authentication is explicitly disabled", async () => {
    const app = createApp({ config: disabledConfig, store: new Store() });
    const response = await app.request("/api/session");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: true,
      authDisabled: true,
      tools: ["read"],
    });
  });

  test("rejects oversized API request bodies", async () => {
    const app = createApp({ config: disabledConfig, store: new Store() });
    const response = await app.request("/api/logout", {
      method: "POST",
      headers: {
        origin: disabledConfig.appOrigin,
        "content-type": "text/plain",
      },
      body: "x".repeat(2_000_001),
    });

    expect(response.status).toBe(413);
  });

  test("rejects cross-origin mutations", async () => {
    const app = createApp({ config: disabledConfig, store: new Store() });
    const response = await app.request("/api/logout", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "origin_mismatch" },
    });
  });

  test("protects workspace reads when authentication is required", async () => {
    const listDirectory = vi.fn(async () => ({
      path: "",
      entries: [],
      truncated: false,
      writable: true,
    }));
    const app = createApp({
      config: { ...disabledConfig, auth: { mode: "oidc" } as never },
      store: new Store(),
      services: apiServices({ listDirectory }),
    });

    const response = await app.request("/api/workspace/entries");

    expect(response.status).toBe(401);
    expect(listDirectory).not.toHaveBeenCalled();
  });

  test("protects project trust mutations before touching the service", async () => {
    const setProjectTrust = vi.fn();
    const app = createApp({
      config: { ...disabledConfig, auth: { mode: "oidc" } as never },
      store: new Store(),
      services: apiServices(
        {},
        {
          projectTrust: () => ({ required: true, trusted: false }),
          setProjectTrust,
        },
      ),
    });

    const response = await app.request("/api/project-trust", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trusted: true, acknowledgeRisk: true }),
    });

    expect(response.status).toBe(401);
    expect(setProjectTrust).not.toHaveBeenCalled();
  });

  test("rejects cross-origin workspace writes before touching the service", async () => {
    const writeFile = vi.fn();
    const app = createApp({
      config: disabledConfig,
      store: new Store(),
      services: apiServices({ writeFile }),
    });

    const response = await app.request("/api/workspace/file", {
      method: "PUT",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ path: "file.txt", content: "private" }),
    });

    expect(response.status).toBe(403);
    expect(writeFile).not.toHaveBeenCalled();
  });

  test("accepts an escaped one-megabyte workspace write body", async () => {
    const writeFile = vi.fn(async () => ({
      path: "file.txt",
      name: "file.txt",
      kind: "file",
      modifiedAt: 1,
      size: 1_000_000,
      revision: "revision",
      editable: true,
      writable: true,
      content: "",
    }));
    const app = createApp({
      config: disabledConfig,
      store: new Store(),
      services: apiServices({ writeFile }),
    });
    const content = "\u0001".repeat(1_000_000);

    const response = await app.request("/api/workspace/file", {
      method: "PUT",
      headers: {
        origin: disabledConfig.appOrigin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ path: "file.txt", content }),
    });

    expect(response.status).toBe(201);
    expect(writeFile).toHaveBeenCalledWith({ path: "file.txt", content });
  });

  test("rejects workspace write bodies above the dedicated limit", async () => {
    const writeFile = vi.fn();
    const app = createApp({
      config: disabledConfig,
      store: new Store(),
      services: apiServices({ writeFile }),
    });

    const response = await app.request("/api/workspace/file", {
      method: "PUT",
      headers: {
        origin: disabledConfig.appOrigin,
        "content-type": "application/json",
      },
      body: "x".repeat(6_100_001),
    });

    expect(response.status).toBe(413);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
