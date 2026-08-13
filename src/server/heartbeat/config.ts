import { parse } from "yaml";
import { parseDuration } from "./duration.js";

export interface HeartbeatConfig {
  enabled: boolean;
  everyMs: number;
  body: string;
  diagnostic?: string;
}

function invalid(body: string, diagnostic: string): HeartbeatConfig {
  return { enabled: false, everyMs: 1_800_000, body, diagnostic };
}

export function parseHeartbeat(content: string): HeartbeatConfig {
  const normalized = content.replace(/\r\n?/g, "\n");
  let body = normalized;
  let metadata: unknown = {};
  if (normalized.startsWith("---\n")) {
    const end = normalized.indexOf("\n---\n", 4);
    if (end < 0) return invalid("", "Heartbeat frontmatter is not closed");
    try {
      metadata = parse(normalized.slice(4, end));
    } catch {
      return invalid("", "Heartbeat frontmatter is invalid YAML");
    }
    body = normalized.slice(end + 5).trim();
  } else {
    body = normalized.trim();
  }

  if (!body) return invalid(body, "Heartbeat instructions are empty");
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return invalid(body, "Heartbeat frontmatter must be an object");
  }
  const value = metadata as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "enabled" && key !== "every")) {
    return invalid(body, "Heartbeat frontmatter contains an unknown field");
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    return invalid(body, "Heartbeat enabled must be true or false");
  }
  if (value.every !== undefined && typeof value.every !== "string") {
    return invalid(body, "Heartbeat every must be a duration string");
  }
  try {
    return {
      enabled: value.enabled ?? true,
      everyMs: parseDuration((value.every as string | undefined) ?? "30m"),
      body,
      ...(value.enabled === false
        ? { diagnostic: "Heartbeat is disabled" }
        : {}),
    };
  } catch (error) {
    return invalid(
      body,
      error instanceof Error ? error.message : "Heartbeat duration is invalid",
    );
  }
}
