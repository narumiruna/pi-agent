import lockfile from "proper-lockfile";

export type ReleaseRuntimeLock = () => Promise<void>;

export async function acquireRuntimeLock(
  agentDir: string,
): Promise<ReleaseRuntimeLock> {
  try {
    return await lockfile.lock(agentDir, {
      realpath: false,
      retries: 0,
      stale: 30_000,
      update: 10_000,
    });
  } catch (error) {
    throw new Error(`Pi Agent is already running for ${agentDir}`, {
      cause: error,
    });
  }
}
