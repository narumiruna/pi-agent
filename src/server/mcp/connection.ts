import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "./config.js";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpConnection {
  listTools(signal?: AbortSignal): Promise<McpToolInfo[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export type McpConnector = (
  name: string,
  config: McpServerConfig,
) => Promise<McpConnection>;

export const connectMcp: McpConnector = async (name, config) => {
  const client = new Client({ name: `pi-agent-${name}`, version: "1.0.0" });
  const transport =
    config.transport === "stdio"
      ? new StdioClientTransport({
          command: config.command,
          ...(config.args ? { args: config.args } : {}),
          ...(config.env ? { env: config.env } : {}),
          stderr: "pipe",
        })
      : new StreamableHTTPClientTransport(
          new URL(config.url),
          config.headers ? { requestInit: { headers: config.headers } } : {},
        );
  if (transport instanceof StdioClientTransport) {
    transport.stderr?.on("data", () => undefined);
  }
  try {
    await client.connect(transport as Transport, { timeout: 30_000 });
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
  return {
    async listTools(signal) {
      const result = await client.listTools(undefined, {
        ...(signal ? { signal } : {}),
        timeout: 30_000,
      });
      return result.tools.map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }));
    },
    callTool: (toolName, args, signal) =>
      client.callTool({ name: toolName, arguments: args }, undefined, {
        ...(signal ? { signal } : {}),
        timeout: 30_000,
      }),
    close: () => client.close(),
  };
};
