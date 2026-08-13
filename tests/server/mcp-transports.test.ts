import { createServer } from "node:http";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { McpConnection } from "../../src/server/mcp/connection.js";
import { connectMcp } from "../../src/server/mcp/connection.js";

const connections: McpConnection[] = [];
const closes: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(
    connections.splice(0).map((connection) => connection.close()),
  );
  await Promise.allSettled(closes.splice(0).map((close) => close()));
});

describe("MCP transports", () => {
  test("connects to a stdio server without a shell", async () => {
    const connection = await connectMcp("stdio", {
      transport: "stdio",
      command: process.execPath,
      args: ["--import", "tsx", resolve("tests/fixtures/mcp-stdio-server.ts")],
    });
    connections.push(connection);

    expect((await connection.listTools()).map((tool) => tool.name)).toContain(
      "echo",
    );
    expect(await connection.callTool("echo", { text: "hello" })).toMatchObject({
      content: [{ type: "text", text: "hello" }],
    });
  });

  test("connects to a stateless Streamable HTTP server", async () => {
    const server = createServer(async (request, response) => {
      if (request.method === "GET") {
        response.writeHead(405).end();
        return;
      }
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const message = JSON.parse(raw) as {
        id?: number;
        method: string;
        params?: unknown;
      };
      response.setHeader("content-type", "application/json");
      if (message.method === "notifications/initialized") {
        response.writeHead(202).end();
      } else if (message.method === "initialize") {
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {} },
              serverInfo: { name: "http-fixture", version: "1.0.0" },
            },
          }),
        );
      } else if (message.method === "tools/list") {
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              tools: [
                {
                  name: "echo",
                  description: "Echo",
                  inputSchema: {
                    type: "object",
                    properties: { text: { type: "string" } },
                  },
                },
              ],
            },
          }),
        );
      } else if (message.method === "tools/call") {
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { content: [{ type: "text", text: "hello" }] },
          }),
        );
      }
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    closes.push(
      () =>
        new Promise((resolveClose, reject) =>
          server.close((error) => (error ? reject(error) : resolveClose())),
        ),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing server address");

    const connection = await connectMcp("http", {
      transport: "http",
      url: `http://127.0.0.1:${address.port}/mcp`,
    });
    connections.push(connection);

    expect((await connection.listTools()).map((tool) => tool.name)).toEqual([
      "echo",
    ]);
    expect(await connection.callTool("echo", { text: "hello" })).toMatchObject({
      content: [{ type: "text", text: "hello" }],
    });
  });
});
