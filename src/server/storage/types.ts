export interface WebSessionRecord {
  tokenHash: string;
  subject: string;
  email?: string;
  createdAt: number;
  expiresAt: number;
}

export type HeartbeatRunStatus =
  | "attention"
  | "error"
  | "quiet"
  | "running"
  | "stopped";

export interface HeartbeatRunRecord {
  id: string;
  startedAt: number;
  finishedAt?: number;
  status: HeartbeatRunStatus;
  summary?: string;
  error?: string;
}

export type HeartbeatRunUpdate = Omit<
  HeartbeatRunRecord,
  "id" | "startedAt"
> & {
  finishedAt: number;
};

export interface AppStore {
  migrate(): Promise<void>;
  createWebSession(session: WebSessionRecord): Promise<void>;
  findWebSession(tokenHash: string): Promise<WebSessionRecord | undefined>;
  deleteWebSession(tokenHash: string): Promise<void>;
  deleteExpiredWebSessions(now: number): Promise<number>;
  createHeartbeatRun(run: HeartbeatRunRecord): Promise<void>;
  finishHeartbeatRun(id: string, update: HeartbeatRunUpdate): Promise<void>;
  latestHeartbeatRun(): Promise<HeartbeatRunRecord | undefined>;
  listHeartbeatRuns(limit: number): Promise<HeartbeatRunRecord[]>;
  close(): Promise<void>;
}
