import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { EventHub } from "./agent/events.js";
import { PiService } from "./agent/pi-service.js";
import { createApp } from "./app.js";
import { parseConfig } from "./config.js";
import { loadHeartbeat } from "./heartbeat/file.js";
import { HeartbeatScheduler } from "./heartbeat/scheduler.js";
import { InteractionBroker } from "./interactions/broker.js";
import { McpManager } from "./mcp/manager.js";
import { ResourceService } from "./resources/service.js";
import { acquireRuntimeLock } from "./runtime-lock.js";
import { createStore } from "./storage/index.js";

export async function main(): Promise<void> {
  const config = parseConfig();
  await Promise.all([
    mkdir(config.agentDir, { recursive: true }),
    mkdir(config.dataDir, { recursive: true }),
    mkdir(config.workspace, { recursive: true }),
  ]);
  const releaseLock = await acquireRuntimeLock(config.agentDir);
  const store = createStore(config);
  let ready = false;
  let pi: PiService | undefined;
  let mcp: McpManager | undefined;
  let heartbeat: HeartbeatScheduler | undefined;
  try {
    await store.migrate();
    const events = new EventHub();
    const interactions = new InteractionBroker(events);
    mcp = new McpManager(join(config.agentDir, "mcp.json"));
    pi = await PiService.create(config, events, interactions, mcp);
    const resources = new ResourceService(
      config.agentDir,
      pi.packageManager,
      () => pi?.reload() ?? Promise.resolve(),
    );
    heartbeat = new HeartbeatScheduler({
      load: () => loadHeartbeat(join(config.agentDir, "HEARTBEAT.md")),
      coordinator: pi.coordinator,
      events,
      runAgent: (prompt) =>
        pi?.runHeartbeat(prompt) ?? Promise.reject(new Error("Agent stopped")),
      abortAgent: () => pi?.abortHeartbeat() ?? Promise.resolve(),
      store,
    });
    await heartbeat.start();
    ready = true;

    const app = createApp({
      config,
      store,
      ready: () => ready,
      services: { pi, interactions, resources, mcp, heartbeat },
    });
    app.use("/assets/*", serveStatic({ root: "./dist/public" }));
    app.get("/", serveStatic({ path: "./dist/public/index.html" }));
    const server = serve({
      fetch: app.fetch,
      hostname: config.host,
      port: config.port,
    });

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      ready = false;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        (
          server as typeof server & { closeAllConnections?: () => void }
        ).closeAllConnections?.();
      });
      interactions.cancelAll();
      await heartbeat?.stop();
      await pi?.dispose();
      await mcp?.close();
      await store.close();
      await releaseLock();
    };
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        void shutdown().then(() => process.exit(0));
      });
    }
  } catch (error) {
    ready = false;
    await heartbeat?.stop();
    await pi?.dispose();
    await mcp?.close();
    await store.close();
    await releaseLock();
    throw error;
  }
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  await main();
}
