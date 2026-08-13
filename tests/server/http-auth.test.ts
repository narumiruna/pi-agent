import { describe, expect, test } from "vitest";
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
    expect(await response.json()).toMatchObject({ authDisabled: true });
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
});
