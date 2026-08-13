import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { acquireRuntimeLock } from "../../src/server/runtime-lock.js";
import { PostgresStore } from "../../src/server/storage/postgres.js";
import { SqliteStore } from "../../src/server/storage/sqlite.js";
import type { AppStore } from "../../src/server/storage/types.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function storageContract(name: string, createStore: () => Promise<AppStore>) {
  describe(name, () => {
    test("atomically claims exactly one OIDC owner", async () => {
      const store = await createStore();
      await store.migrate();

      const candidates = await Promise.all([
        store.claimOwner({
          issuer: "https://id.example.com",
          subject: "owner-1",
          email: "owner@example.com",
          claimedAt: 1_000,
        }),
        store.claimOwner({
          issuer: "https://id.example.com",
          subject: "owner-2",
          claimedAt: 2_000,
        }),
      ]);
      expect(new Set(candidates.map((owner) => owner.subject)).size).toBe(1);
      expect(await store.getOwner()).toEqual(candidates[0]);
    });

    test("preserves sessions after ownership has been claimed and migration reruns", async () => {
      const store = await createStore();
      await store.migrate();
      await store.claimOwner({
        issuer: "https://id.example.com",
        subject: "owner-1",
        claimedAt: 1_000,
      });
      await store.createWebSession({
        tokenHash: "kept",
        subject: "owner-1",
        createdAt: 1_000,
        expiresAt: 2_000,
      });

      await store.migrate();

      expect(await store.findWebSession("kept")).toBeDefined();
    });

    test("migrates idempotently and persists web sessions", async () => {
      const store = await createStore();
      await store.migrate();
      await store.migrate();
      const session = {
        tokenHash: "hash-1",
        subject: "owner-1",
        email: "owner@example.com",
        createdAt: 1_000,
        expiresAt: 2_000,
      };

      await store.createWebSession(session);
      expect(await store.findWebSession("hash-1")).toEqual(session);
      await store.deleteWebSession("hash-1");
      expect(await store.findWebSession("hash-1")).toBeUndefined();
    });

    test("deletes expired sessions without deleting valid sessions", async () => {
      const store = await createStore();
      await store.migrate();
      await store.createWebSession({
        tokenHash: "old",
        subject: "owner",
        createdAt: 1,
        expiresAt: 9,
      });
      await store.createWebSession({
        tokenHash: "new",
        subject: "owner",
        createdAt: 2,
        expiresAt: 11,
      });

      expect(await store.deleteExpiredWebSessions(10)).toBe(1);
      expect(await store.findWebSession("new")).toBeDefined();
    });

    test("records heartbeat lifecycle and orders newest first", async () => {
      const store = await createStore();
      await store.migrate();
      await store.createHeartbeatRun({
        id: "run-1",
        startedAt: 10,
        status: "running",
      });
      await store.finishHeartbeatRun("run-1", {
        status: "attention",
        finishedAt: 20,
        summary: "Needs review",
      });
      await store.createHeartbeatRun({
        id: "run-2",
        startedAt: 30,
        status: "running",
      });

      expect(await store.latestHeartbeatRun()).toMatchObject({ id: "run-2" });
      expect((await store.listHeartbeatRuns(10)).map((run) => run.id)).toEqual([
        "run-2",
        "run-1",
      ]);
    });
  });
}

storageContract("SQLite store", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-agent-store-"));
  const store = new SqliteStore(join(directory, "app.db"));
  cleanups.push(async () => {
    await store.close();
    await rm(directory, { force: true, recursive: true });
  });
  return store;
});

const postgresUrl = process.env.TEST_POSTGRES_URL;
describe.runIf(postgresUrl)("PostgreSQL store", () => {
  storageContract("PostgreSQL contract", async () => {
    const store = new PostgresStore(postgresUrl as string);
    cleanups.push(async () => {
      await store.resetForTests();
      await store.close();
    });
    return store;
  });
});

describe("runtime lock", () => {
  test("allows only one writer for an agent directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-agent-lock-"));
    cleanups.push(() => rm(directory, { force: true, recursive: true }));

    const release = await acquireRuntimeLock(directory);
    await expect(acquireRuntimeLock(directory)).rejects.toThrow(
      /already running/i,
    );
    await release();
    const releaseAgain = await acquireRuntimeLock(directory);
    await releaseAgain();
  });
});
