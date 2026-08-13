import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  McpManager,
  readMcpConfig,
  redactMcpConfig,
  writeMcpConfig,
} from "../../src/server/mcp/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function tempConfig() {
  const directory = await mkdtemp(join(tmpdir(), "pi-agent-mcp-"));
  directories.push(directory);
  return join(directory, "mcp.json");
}

describe("MCP configuration", () => {
  test("supports stdio and Streamable HTTP without legacy SSE", async () => {
    const path = await tempConfig();
    await writeFile(
      path,
      JSON.stringify({
        mcpServers: {
          local: {
            command: "node",
            args: ["server.js"],
            env: { TOKEN: "secret" },
          },
          remote: {
            url: "https://mcp.example.com",
            headers: { Authorization: "Bearer secret" },
          },
        },
      }),
    );

    const config = await readMcpConfig(path);
    expect(config.mcpServers.local).toMatchObject({
      transport: "stdio",
      command: "node",
    });
    expect(config.mcpServers.remote).toMatchObject({
      transport: "http",
      url: "https://mcp.example.com/",
    });
  });

  test("rejects shell strings, legacy transports, and unsafe URLs", async () => {
    const path = await tempConfig();
    await writeFile(
      path,
      JSON.stringify({ mcpServers: { bad: { command: "node server.js" } } }),
    );
    await expect(readMcpConfig(path)).rejects.toThrow(/command/i);

    await writeFile(
      path,
      JSON.stringify({ mcpServers: { bad: { url: "file:///etc/passwd" } } }),
    );
    await expect(readMcpConfig(path)).rejects.toThrow(/http/i);

    await writeFile(
      path,
      JSON.stringify({
        mcpServers: { bad: { type: "sse", url: "https://example.com" } },
      }),
    );
    await expect(readMcpConfig(path)).rejects.toThrow(/legacy|unsupported/i);
  });

  test("redacts secrets and preserves them during masked updates", async () => {
    const path = await tempConfig();
    const original = {
      mcpServers: {
        remote: {
          transport: "http" as const,
          url: "https://mcp.example.com/",
          headers: { Authorization: "secret" },
        },
      },
    };
    await writeMcpConfig(path, original);

    const redacted = redactMcpConfig(original);
    expect(redacted.mcpServers.remote).toMatchObject({
      headers: { Authorization: "********" },
    });
    await writeMcpConfig(path, redacted, original);
    expect(await readMcpConfig(path)).toEqual(original);
    expect(await readFile(path, "utf8")).toContain("secret");
  });

  test("rejects a masked secret when there is no previous value", async () => {
    const path = await tempConfig();
    await expect(
      writeMcpConfig(path, {
        mcpServers: {
          remote: {
            transport: "http",
            url: "https://mcp.example.com/",
            headers: { Authorization: "********" },
          },
        },
      }),
    ).rejects.toThrow(/masked secret/i);
  });
});

describe("MCP manager", () => {
  test("isolates failed servers and prefixes discovered tools", async () => {
    const path = await tempConfig();
    await writeMcpConfig(path, {
      mcpServers: {
        good: { transport: "http", url: "https://good.example.com/" },
        bad: { transport: "http", url: "https://bad.example.com/" },
      },
    });
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "ok" }],
    }));
    const manager = new McpManager(path, async (name) => {
      if (name === "bad") throw new Error("offline");
      return {
        listTools: async () => [
          {
            name: "search",
            description: "Search",
            inputSchema: { type: "object", properties: {} },
          },
        ],
        callTool,
        close: async () => undefined,
      };
    });

    const result = await manager.load();
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "mcp__good__search",
    ]);
    expect(result.diagnostics).toMatchObject([
      { server: "bad", level: "error" },
    ]);

    await result.tools[0]?.execute(
      "call-1",
      {},
      undefined,
      undefined,
      {} as never,
    );
    expect(callTool).toHaveBeenCalledWith("search", {}, undefined);
    await manager.close();
  });
});
