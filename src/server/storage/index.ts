import type { AppConfig } from "../config.js";
import { PostgresStore } from "./postgres.js";
import { SqliteStore } from "./sqlite.js";
import type { AppStore } from "./types.js";

export function createStore(config: AppConfig): AppStore {
  return config.databaseUrl
    ? new PostgresStore(config.databaseUrl)
    : new SqliteStore(config.sqlitePath);
}

export type {
  AppStore,
  HeartbeatRunRecord,
  HeartbeatRunStatus,
  HeartbeatRunUpdate,
  WebSessionRecord,
} from "./types.js";
