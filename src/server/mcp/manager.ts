import type {
  InlineExtension,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readMcpConfig } from "./config.js";
import {
  connectMcp,
  type McpConnection,
  type McpConnector,
} from "./connection.js";

export interface McpDiagnostic {
  server: string;
  level: "error" | "warning";
  message: string;
}

export interface McpLoadResult {
  tools: ToolDefinition[];
  diagnostics: McpDiagnostic[];
}

function toolPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function contentText(result: unknown): string {
  if (!result || typeof result !== "object")
    return JSON.stringify(result) ?? String(result);
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return JSON.stringify(result) ?? String(result);
  const texts = content
    .filter(
      (item): item is { type: "text"; text: string } =>
        item?.type === "text" && typeof item.text === "string",
    )
    .map((item) => item.text);
  return texts.length > 0
    ? texts.join("\n")
    : (JSON.stringify(result) ?? String(result));
}

export class McpManager {
  private connections: McpConnection[] = [];
  private currentDiagnostics: McpDiagnostic[] = [];

  constructor(
    private readonly path: string,
    private readonly connect: McpConnector = connectMcp,
  ) {}

  async load(): Promise<McpLoadResult> {
    await this.close();
    const config = await readMcpConfig(this.path);
    const tools: ToolDefinition[] = [];
    const diagnostics: McpDiagnostic[] = [];
    const names = new Set<string>();
    for (const [serverName, server] of Object.entries(config.mcpServers)) {
      try {
        const connection = await this.connect(serverName, server);
        this.connections.push(connection);
        for (const tool of await connection.listTools()) {
          const name = `mcp__${toolPart(serverName)}__${toolPart(tool.name)}`;
          if (names.has(name)) {
            diagnostics.push({
              server: serverName,
              level: "warning",
              message: `MCP tool collision: ${name}`,
            });
            continue;
          }
          names.add(name);
          tools.push({
            name,
            label: tool.name,
            description:
              tool.description ??
              `Call ${tool.name} on MCP server ${serverName}`,
            parameters: Type.Unsafe(tool.inputSchema),
            async execute(_id, params, signal) {
              const result = await connection.callTool(
                tool.name,
                params as Record<string, unknown>,
                signal,
              );
              return {
                content: [{ type: "text", text: contentText(result) }],
                details: result,
              };
            },
          });
        }
      } catch (error) {
        diagnostics.push({
          server: serverName,
          level: "error",
          message:
            error instanceof Error ? error.message : "MCP connection failed",
        });
      }
    }
    this.currentDiagnostics = diagnostics;
    return { tools, diagnostics };
  }

  diagnostics(): readonly McpDiagnostic[] {
    return this.currentDiagnostics;
  }

  extension(): InlineExtension {
    return {
      name: "mcp",
      factory: async (pi) => {
        const result = await this.load();
        for (const tool of result.tools) pi.registerTool(tool);
        pi.on("session_shutdown", async () => this.close());
      },
    };
  }

  async close(): Promise<void> {
    const connections = this.connections.splice(0);
    await Promise.allSettled(
      connections.map((connection) => connection.close()),
    );
  }
}
