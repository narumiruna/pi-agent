import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AppStore,
  HeartbeatRunRecord,
  HeartbeatRunUpdate,
  OwnerRecord,
  WebSessionRecord,
} from "./types.js";

interface OwnerRow {
  issuer: string;
  subject: string;
  email: string | null;
  claimed_at: number;
}

interface SessionRow {
  token_hash: string;
  subject: string;
  email: string | null;
  created_at: number;
  expires_at: number;
}

interface HeartbeatRow {
  id: string;
  started_at: number;
  finished_at: number | null;
  status: HeartbeatRunRecord["status"];
  summary: string | null;
  error: string | null;
  details: string | null;
}

function mapOwner(row: OwnerRow): OwnerRecord {
  return {
    issuer: row.issuer,
    subject: row.subject,
    ...(row.email ? { email: row.email } : {}),
    claimedAt: row.claimed_at,
  };
}

function mapSession(row: SessionRow): WebSessionRecord {
  return {
    tokenHash: row.token_hash,
    subject: row.subject,
    ...(row.email ? { email: row.email } : {}),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function mapHeartbeat(row: HeartbeatRow): HeartbeatRunRecord {
  return {
    id: row.id,
    startedAt: row.started_at,
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
    status: row.status,
    ...(row.summary === null ? {} : { summary: row.summary }),
    ...(row.error === null ? {} : { error: row.error }),
    ...(row.details === null
      ? {}
      : {
          details: JSON.parse(row.details) as NonNullable<
            HeartbeatRunRecord["details"]
          >,
        }),
  };
}

export class SqliteStore implements AppStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
  }

  async migrate(): Promise<void> {
    this.database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS app_owner (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        issuer TEXT NOT NULL,
        subject TEXT NOT NULL,
        email TEXT,
        claimed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS web_sessions (
        token_hash TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        email TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS web_sessions_expires_at ON web_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS heartbeat_runs (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        status TEXT NOT NULL,
        summary TEXT,
        error TEXT,
        details TEXT
      );
      CREATE INDEX IF NOT EXISTS heartbeat_runs_started_at ON heartbeat_runs(started_at DESC);
      INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
      INSERT OR IGNORE INTO schema_migrations(version) VALUES (2);
      COMMIT;
    `);
    const heartbeatColumns = this.database
      .prepare("PRAGMA table_info(heartbeat_runs)")
      .all() as unknown as Array<{ name: string }>;
    if (!heartbeatColumns.some((column) => column.name === "details"))
      this.database.exec("ALTER TABLE heartbeat_runs ADD COLUMN details TEXT");
    this.database
      .prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES (3)")
      .run();
    const owner = await this.getOwner();
    if (!owner) this.database.prepare("DELETE FROM web_sessions").run();
  }

  async claimOwner(owner: OwnerRecord): Promise<OwnerRecord> {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO app_owner(singleton, issuer, subject, email, claimed_at)
         VALUES (1, ?, ?, ?, ?)`,
      )
      .run(owner.issuer, owner.subject, owner.email ?? null, owner.claimedAt);
    return (await this.getOwner()) as OwnerRecord;
  }

  async getOwner(): Promise<OwnerRecord | undefined> {
    const row = this.database
      .prepare(
        "SELECT issuer, subject, email, claimed_at FROM app_owner WHERE singleton = 1",
      )
      .get() as OwnerRow | undefined;
    return row ? mapOwner(row) : undefined;
  }

  async createWebSession(session: WebSessionRecord): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO web_sessions(token_hash, subject, email, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        session.tokenHash,
        session.subject,
        session.email ?? null,
        session.createdAt,
        session.expiresAt,
      );
  }

  async findWebSession(
    tokenHash: string,
  ): Promise<WebSessionRecord | undefined> {
    const row = this.database
      .prepare("SELECT * FROM web_sessions WHERE token_hash = ?")
      .get(tokenHash) as SessionRow | undefined;
    return row ? mapSession(row) : undefined;
  }

  async deleteWebSession(tokenHash: string): Promise<void> {
    this.database
      .prepare("DELETE FROM web_sessions WHERE token_hash = ?")
      .run(tokenHash);
  }

  async deleteExpiredWebSessions(now: number): Promise<number> {
    const result = this.database
      .prepare("DELETE FROM web_sessions WHERE expires_at <= ?")
      .run(now);
    return Number(result.changes);
  }

  async createHeartbeatRun(run: HeartbeatRunRecord): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO heartbeat_runs(id, started_at, finished_at, status, summary, error, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.startedAt,
        run.finishedAt ?? null,
        run.status,
        run.summary ?? null,
        run.error ?? null,
        run.details ? JSON.stringify(run.details) : null,
      );
  }

  async finishHeartbeatRun(
    id: string,
    update: HeartbeatRunUpdate,
  ): Promise<void> {
    this.database
      .prepare(
        `UPDATE heartbeat_runs SET finished_at = ?, status = ?, summary = ?, error = ?, details = ? WHERE id = ?`,
      )
      .run(
        update.finishedAt,
        update.status,
        update.summary ?? null,
        update.error ?? null,
        update.details ? JSON.stringify(update.details) : null,
        id,
      );
  }

  async latestHeartbeatRun(): Promise<HeartbeatRunRecord | undefined> {
    const row = this.database
      .prepare("SELECT * FROM heartbeat_runs ORDER BY started_at DESC LIMIT 1")
      .get() as HeartbeatRow | undefined;
    return row ? mapHeartbeat(row) : undefined;
  }

  async listHeartbeatRuns(limit: number): Promise<HeartbeatRunRecord[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = this.database
      .prepare("SELECT * FROM heartbeat_runs ORDER BY started_at DESC LIMIT ?")
      .all(safeLimit) as unknown as HeartbeatRow[];
    return rows.map(mapHeartbeat);
  }

  async close(): Promise<void> {
    this.database.close();
  }
}
