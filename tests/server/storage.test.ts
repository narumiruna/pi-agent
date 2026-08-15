import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";
import { afterEach, describe, expect, test } from "vitest";
import { acquireRuntimeLock } from "../../src/server/runtime-lock.js";
import { PostgresStore } from "../../src/server/storage/postgres.js";
import { SqliteStore } from "../../src/server/storage/sqlite.js";
import type { AppStore } from "../../src/server/storage/types.js";

const cleanups: Array<() => Promise<void>> = [];
const forbiddenConversationTables = new Set([
  "conversations",
  "conversation_messages",
  "chat_messages",
  "session_entries",
  "session_jsonl",
  "transcripts",
]);

function expectNoConversationMirror(tables: string[]): void {
  expect(
    tables.filter((table) => forbiddenConversationTables.has(table)),
  ).toEqual([]);
}

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
        details: {
          response: "The full response",
          tools: [
            {
              id: "tool-1",
              name: "bash",
              input: "curl weather.example",
              output: "connection refused",
              isError: true,
            },
          ],
        },
      });
      await store.createHeartbeatRun({
        id: "run-2",
        startedAt: 30,
        status: "running",
      });

      expect(await store.latestHeartbeatRun()).toMatchObject({ id: "run-2" });
      const runs = await store.listHeartbeatRuns(10);
      expect(runs.map((run) => run.id)).toEqual(["run-2", "run-1"]);
      expect(runs[1]?.details).toMatchObject({
        response: "The full response",
        tools: [{ output: "connection refused", isError: true }],
      });
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

test("does not create a mirror for native conversation JSONL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-agent-store-schema-"));
  const path = join(directory, "app.db");
  const store = new SqliteStore(path);
  cleanups.push(async () => {
    await store.close();
    await rm(directory, { force: true, recursive: true });
  });
  await store.migrate();

  const database = new DatabaseSync(path, { readOnly: true });
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => String(row.name));
  database.close();

  expect(tables).toEqual(
    expect.arrayContaining([
      "app_owner",
      "heartbeat_runs",
      "schema_migrations",
      "web_sessions",
    ]),
  );
  expectNoConversationMirror(tables);
});

test("migrates an existing SQLite heartbeat table for run details", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-agent-store-migration-"));
  const path = join(directory, "app.db");
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE heartbeat_runs (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL,
      summary TEXT,
      error TEXT
    );
  `);
  legacy.close();
  const store = new SqliteStore(path);
  cleanups.push(async () => {
    await store.close();
    await rm(directory, { force: true, recursive: true });
  });

  await store.migrate();
  await store.createHeartbeatRun({
    id: "detailed",
    startedAt: 1,
    status: "running",
    details: { response: "diagnostic" },
  });

  await expect(store.latestHeartbeatRun()).resolves.toMatchObject({
    id: "detailed",
    details: { response: "diagnostic" },
  });
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

  test("does not create a mirror for native conversation JSONL", async () => {
    const store = new PostgresStore(postgresUrl as string);
    const sql = postgres(postgresUrl as string, { max: 1 });
    cleanups.push(async () => {
      await store.resetForTests();
      await store.close();
      await sql.end({ timeout: 5 });
    });
    await store.migrate();

    const rows = await sql<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    const tables = rows.map((row) => row.table_name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "app_owner",
        "heartbeat_runs",
        "schema_migrations",
        "web_sessions",
      ]),
    );
    expectNoConversationMirror(tables);
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
