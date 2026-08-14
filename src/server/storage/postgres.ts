import postgres, { type Sql } from "postgres";
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
  claimed_at: string | number;
}

interface SessionRow {
  token_hash: string;
  subject: string;
  email: string | null;
  created_at: string | number;
  expires_at: string | number;
}

interface HeartbeatRow {
  id: string;
  started_at: string | number;
  finished_at: string | number | null;
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
    claimedAt: Number(row.claimed_at),
  };
}

function mapSession(row: SessionRow): WebSessionRecord {
  return {
    tokenHash: row.token_hash,
    subject: row.subject,
    ...(row.email ? { email: row.email } : {}),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  };
}

function mapHeartbeat(row: HeartbeatRow): HeartbeatRunRecord {
  return {
    id: row.id,
    startedAt: Number(row.started_at),
    ...(row.finished_at === null
      ? {}
      : { finishedAt: Number(row.finished_at) }),
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

export class PostgresStore implements AppStore {
  private readonly sql: Sql;

  constructor(url: string) {
    this.sql = postgres(url, { max: 4 });
  }

  async migrate(): Promise<void> {
    await this.sql.begin(async (sql) => {
      await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`;
      await sql`CREATE TABLE IF NOT EXISTS app_owner (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        issuer TEXT NOT NULL,
        subject TEXT NOT NULL,
        email TEXT,
        claimed_at BIGINT NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS web_sessions (
        token_hash TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        email TEXT,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS web_sessions_expires_at ON web_sessions(expires_at)`;
      await sql`CREATE TABLE IF NOT EXISTS heartbeat_runs (
        id TEXT PRIMARY KEY,
        started_at BIGINT NOT NULL,
        finished_at BIGINT,
        status TEXT NOT NULL,
        summary TEXT,
        error TEXT,
        details TEXT
      )`;
      await sql`ALTER TABLE heartbeat_runs ADD COLUMN IF NOT EXISTS details TEXT`;
      await sql`CREATE INDEX IF NOT EXISTS heartbeat_runs_started_at ON heartbeat_runs(started_at DESC)`;
      await sql`INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING`;
      const inserted =
        await sql`INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING RETURNING version`;
      if (inserted.count > 0) await sql`DELETE FROM web_sessions`;
      await sql`INSERT INTO schema_migrations(version) VALUES (3) ON CONFLICT DO NOTHING`;
    });
  }

  async claimOwner(owner: OwnerRecord): Promise<OwnerRecord> {
    return this.sql.begin(async (sql) => {
      await sql`INSERT INTO app_owner(singleton, issuer, subject, email, claimed_at)
        VALUES (TRUE, ${owner.issuer}, ${owner.subject}, ${owner.email ?? null}, ${owner.claimedAt})
        ON CONFLICT (singleton) DO NOTHING`;
      const rows = await sql<
        OwnerRow[]
      >`SELECT issuer, subject, email, claimed_at FROM app_owner WHERE singleton = TRUE`;
      return mapOwner(rows[0] as OwnerRow);
    });
  }

  async getOwner(): Promise<OwnerRecord | undefined> {
    const rows = await this.sql<
      OwnerRow[]
    >`SELECT issuer, subject, email, claimed_at FROM app_owner WHERE singleton = TRUE`;
    return rows[0] ? mapOwner(rows[0]) : undefined;
  }

  async createWebSession(session: WebSessionRecord): Promise<void> {
    await this
      .sql`INSERT INTO web_sessions(token_hash, subject, email, created_at, expires_at)
      VALUES (${session.tokenHash}, ${session.subject}, ${session.email ?? null}, ${session.createdAt}, ${session.expiresAt})`;
  }

  async findWebSession(
    tokenHash: string,
  ): Promise<WebSessionRecord | undefined> {
    const rows = await this.sql<
      SessionRow[]
    >`SELECT * FROM web_sessions WHERE token_hash = ${tokenHash}`;
    return rows[0] ? mapSession(rows[0]) : undefined;
  }

  async deleteWebSession(tokenHash: string): Promise<void> {
    await this.sql`DELETE FROM web_sessions WHERE token_hash = ${tokenHash}`;
  }

  async deleteExpiredWebSessions(now: number): Promise<number> {
    const result = await this
      .sql`DELETE FROM web_sessions WHERE expires_at <= ${now}`;
    return result.count;
  }

  async createHeartbeatRun(run: HeartbeatRunRecord): Promise<void> {
    await this
      .sql`INSERT INTO heartbeat_runs(id, started_at, finished_at, status, summary, error, details)
      VALUES (${run.id}, ${run.startedAt}, ${run.finishedAt ?? null}, ${run.status}, ${run.summary ?? null}, ${run.error ?? null}, ${run.details ? JSON.stringify(run.details) : null})`;
  }

  async finishHeartbeatRun(
    id: string,
    update: HeartbeatRunUpdate,
  ): Promise<void> {
    await this.sql`UPDATE heartbeat_runs
      SET finished_at = ${update.finishedAt}, status = ${update.status}, summary = ${update.summary ?? null}, error = ${update.error ?? null}, details = ${update.details ? JSON.stringify(update.details) : null}
      WHERE id = ${id}`;
  }

  async latestHeartbeatRun(): Promise<HeartbeatRunRecord | undefined> {
    const rows = await this.sql<
      HeartbeatRow[]
    >`SELECT * FROM heartbeat_runs ORDER BY started_at DESC LIMIT 1`;
    return rows[0] ? mapHeartbeat(rows[0]) : undefined;
  }

  async listHeartbeatRuns(limit: number): Promise<HeartbeatRunRecord[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = await this.sql<
      HeartbeatRow[]
    >`SELECT * FROM heartbeat_runs ORDER BY started_at DESC LIMIT ${safeLimit}`;
    return rows.map(mapHeartbeat);
  }

  async resetForTests(): Promise<void> {
    await this.sql`TRUNCATE heartbeat_runs, web_sessions, app_owner`;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
