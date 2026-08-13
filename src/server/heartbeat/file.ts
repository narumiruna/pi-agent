import { readFile } from "node:fs/promises";
import { type HeartbeatConfig, parseHeartbeat } from "./config.js";

export async function loadHeartbeat(path: string): Promise<HeartbeatConfig> {
  try {
    return parseHeartbeat(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        enabled: false,
        everyMs: 1_800_000,
        body: "",
        diagnostic: "HEARTBEAT.md does not exist",
      };
    }
    throw error;
  }
}
