import { readFile } from "node:fs/promises";
import { atomicWrite } from "../resources/atomic-write.js";

const MASK = "********";
const SERVER_NAME = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;

export interface StdioMcpServer {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpMcpServer {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = StdioMcpServer | HttpMcpServer;

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

function stringRecord(
  value: unknown,
  label: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  const entries = Object.entries(value);
  if (
    entries.some(([key, item]) => key.length === 0 || typeof item !== "string")
  ) {
    throw new Error(`${label} must contain string values`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseServer(name: string, input: unknown): McpServerConfig {
  if (!SERVER_NAME.test(name))
    throw new Error(`MCP server name is invalid: ${name}`);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error(`MCP server ${name} is invalid`);
  const value = input as Record<string, unknown>;
  if (value.type === "sse" || value.transport === "sse")
    throw new Error("Legacy MCP SSE transport is unsupported");
  if (typeof value.command === "string") {
    if (value.command.length === 0 || /\s/.test(value.command)) {
      throw new Error(
        `MCP command for ${name} must be one executable without shell arguments`,
      );
    }
    if (
      value.args !== undefined &&
      (!Array.isArray(value.args) ||
        value.args.some((item) => typeof item !== "string"))
    ) {
      throw new Error(`MCP args for ${name} must be strings`);
    }
    const env = stringRecord(value.env, `MCP env for ${name}`);
    return {
      transport: "stdio",
      command: value.command,
      ...(value.args ? { args: value.args as string[] } : {}),
      ...(env ? { env } : {}),
    };
  }
  if (typeof value.url === "string") {
    const url = new URL(value.url);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
      throw new Error(
        `MCP HTTP URL for ${name} must use http or https without credentials`,
      );
    }
    const headers = stringRecord(value.headers, `MCP headers for ${name}`);
    return {
      transport: "http",
      url: url.href,
      ...(headers ? { headers } : {}),
    };
  }
  throw new Error(`MCP server ${name} must define command or URL`);
}

export function parseMcpConfig(input: unknown): McpConfig {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("MCP config must be an object");
  const servers = (input as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw new Error("MCP config must contain mcpServers");
  }
  return {
    mcpServers: Object.fromEntries(
      Object.entries(servers).map(([name, server]) => [
        name,
        parseServer(name, server),
      ]),
    ),
  };
}

export async function readMcpConfig(path: string): Promise<McpConfig> {
  try {
    return parseMcpConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { mcpServers: {} };
    throw error;
  }
}

export function redactMcpConfig(config: McpConfig): McpConfig {
  return {
    mcpServers: Object.fromEntries(
      Object.entries(config.mcpServers).map(([name, server]) => [
        name,
        server.transport === "stdio"
          ? {
              ...server,
              ...(server.env
                ? {
                    env: Object.fromEntries(
                      Object.keys(server.env).map((key) => [key, MASK]),
                    ),
                  }
                : {}),
            }
          : {
              ...server,
              ...(server.headers
                ? {
                    headers: Object.fromEntries(
                      Object.keys(server.headers).map((key) => [key, MASK]),
                    ),
                  }
                : {}),
            },
      ]),
    ),
  } as McpConfig;
}

function restoreRecord(
  name: string,
  values: Record<string, string> | undefined,
  previous: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!values) return undefined;
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      if (value !== MASK) return [key, value];
      const saved = previous?.[key];
      if (saved === undefined) {
        throw new Error(
          `MCP server ${name} contains a masked secret without a previous value`,
        );
      }
      return [key, saved];
    }),
  );
}

function restoreSecrets(next: McpConfig, previous?: McpConfig): McpConfig {
  return {
    mcpServers: Object.fromEntries(
      Object.entries(next.mcpServers).map(([name, server]) => {
        const old = previous?.mcpServers[name];
        if (server.transport === "stdio") {
          const env = restoreRecord(
            name,
            server.env,
            old?.transport === "stdio" ? old.env : undefined,
          );
          return [name, { ...server, ...(env ? { env } : {}) }];
        }
        const headers = restoreRecord(
          name,
          server.headers,
          old?.transport === "http" ? old.headers : undefined,
        );
        return [name, { ...server, ...(headers ? { headers } : {}) }];
      }),
    ),
  } as McpConfig;
}

export async function writeMcpConfig(
  path: string,
  config: McpConfig,
  previous?: McpConfig,
): Promise<void> {
  const normalized = parseMcpConfig(restoreSecrets(config, previous));
  await atomicWrite(path, `${JSON.stringify(normalized, null, 2)}\n`);
}
