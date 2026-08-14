import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { tbValidator } from "@hono/typebox-validator";
import type { Context, Env, Hono, Input } from "hono";
import { streamSSE } from "hono/streaming";
import { Type } from "typebox";
import {
  apiError,
  CHAT_IMAGE_MIME_TYPES,
  MAX_CHAT_IMAGE_BASE64_LENGTH,
  MAX_CHAT_IMAGES,
} from "../shared/contracts.js";
import type { WebEvent } from "./agent/events.js";
import type { PiService } from "./agent/pi-service.js";
import { AgentBusyError } from "./agent/run-coordinator.js";
import type { AppConfig } from "./config.js";
import type { HeartbeatScheduler } from "./heartbeat/scheduler.js";
import type { InteractionBroker } from "./interactions/broker.js";
import {
  type McpConfig,
  readMcpConfig,
  redactMcpConfig,
  writeMcpConfig,
} from "./mcp/config.js";
import type { McpManager } from "./mcp/manager.js";
import type { ResourceService } from "./resources/service.js";
import type { AppStore, WebSessionRecord } from "./storage/types.js";

export interface ApiEnv extends Env {
  Variables: { session?: WebSessionRecord };
}

export interface ApiServices {
  config: AppConfig;
  store: AppStore;
  pi: PiService;
  interactions: InteractionBroker;
  resources: ResourceService;
  mcp: McpManager;
  heartbeat: HeartbeatScheduler;
}

const MessageBody = Type.Object({
  message: Type.String({ maxLength: 100_000 }),
  images: Type.Optional(
    Type.Array(
      Type.Object({
        type: Type.Literal("image"),
        data: Type.String({
          minLength: 1,
          maxLength: MAX_CHAT_IMAGE_BASE64_LENGTH,
        }),
        mimeType: Type.Union(
          CHAT_IMAGE_MIME_TYPES.map((mimeType) => Type.Literal(mimeType)),
        ),
      }),
      { maxItems: MAX_CHAT_IMAGES },
    ),
  ),
});
const RenameBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
});
const InteractionBody = Type.Object({
  value: Type.Optional(Type.String({ maxLength: 1_000_000 })),
});
const ModelBody = Type.Object({
  provider: Type.String(),
  modelId: Type.String(),
});
const ThinkingBody = Type.Object({
  level: Type.Union(
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) =>
      Type.Literal(level),
    ),
  ),
});
const ProviderLoginBody = Type.Object({
  type: Type.Union([Type.Literal("api_key"), Type.Literal("oauth")]),
  apiKey: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000 })),
});
const DocumentBody = Type.Object({
  content: Type.String({ maxLength: 1_000_000 }),
});
const PackageBody = Type.Object({
  source: Type.String({ maxLength: 2_048 }),
  acknowledgeRisk: Type.Literal(true),
});
const McpBody = Type.Object({
  mcpServers: Type.Record(Type.String(), Type.Unknown()),
});

function documentKind(value: string): "append" | "heartbeat" | "system" {
  if (value === "append" || value === "heartbeat" || value === "system")
    return value;
  throw new Error("Document kind is invalid");
}

function errorResponse<E extends Env, P extends string, I extends Input>(
  context: Context<E, P, I>,
  error: unknown,
) {
  if (error instanceof AgentBusyError)
    return context.json(apiError("agent_busy"), 409);
  if (error instanceof DOMException && error.name === "AbortError")
    return context.json(apiError("cancelled"), 400);
  const message = error instanceof Error ? error.message : "";
  if (/not found/i.test(message))
    return context.json(apiError("not_found"), 404);
  if (/no API key|provider is not configured/i.test(message))
    return context.json(apiError("provider_not_configured"), 400);
  if (/active conversation|already|in progress/i.test(message))
    return context.json(apiError("conflict"), 409);
  return context.json(apiError("bad_request"), 400);
}

export function registerApi<E extends ApiEnv>(
  app: Hono<E>,
  services: ApiServices,
): void {
  const mcpPath = join(services.config.agentDir, "mcp.json");

  app.get("/api/conversations", async (context) =>
    context.json(await services.pi.listConversations()),
  );
  app.post("/api/conversations", async (context) =>
    context.json({ id: await services.pi.createConversation() }, 201),
  );
  app.get("/api/conversations/:id", async (context) => {
    try {
      return context.json({
        messages: await services.pi.transcript(context.req.param("id")),
      });
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  app.patch(
    "/api/conversations/:id",
    tbValidator("json", RenameBody),
    async (context) => {
      try {
        await services.pi.renameConversation(
          context.req.param("id"),
          context.req.valid("json").name,
        );
        return context.json({ ok: true });
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.delete("/api/conversations/:id", async (context) => {
    try {
      await services.pi.deleteConversation(context.req.param("id"));
      return context.body(null, 204);
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  app.post(
    "/api/conversations/:id/messages",
    tbValidator("json", MessageBody),
    async (context) => {
      try {
        const body = context.req.valid("json");
        const runId = await services.pi.prompt(
          context.req.param("id"),
          body.message,
          body.images,
        );
        return context.json({ runId }, 202);
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.post("/api/runs/abort", async (context) => {
    await services.pi.abort();
    return context.json({ ok: true });
  });

  app.get("/api/events", (context) =>
    streamSSE(context, async (stream) => {
      const rawCursor = context.req.header("last-event-id");
      const replay = rawCursor
        ? services.pi.events.replayAfter(Number(rawCursor))
        : [];
      const initialCursor = services.pi.events.cursor;
      const queued: WebEvent[] = [];
      let live = false;
      let close = () => undefined;
      const writeEvent = (event: WebEvent) =>
        stream.writeSSE({
          id: String(event.id),
          event: event.type,
          data: JSON.stringify(event.data),
        });
      const unsubscribe = services.pi.events.subscribe((event) => {
        if (!live) queued.push(event);
        else void writeEvent(event).catch(close);
      });
      if (!rawCursor) {
        services.interactions.replayPending((data) =>
          queued.push({ id: initialCursor, type: "interaction", data }),
        );
      }
      try {
        if (replay === undefined) {
          await stream.writeSSE({
            id: String(initialCursor),
            event: "reset",
            data: "{}",
          });
        } else {
          if (!rawCursor) {
            await stream.writeSSE({
              id: String(initialCursor),
              event: "ready",
              data: "{}",
            });
          }
          for (const event of replay) await writeEvent(event);
        }
        while (queued.length > 0) await writeEvent(queued.shift() as WebEvent);
      } catch {
        unsubscribe();
        return;
      }
      live = true;
      await new Promise<void>((resolve) => {
        let closed = false;
        const session = context.get("session");
        const keepAlive = setInterval(() => {
          void (async () => {
            if (session) {
              const current = await services.store.findWebSession(
                session.tokenHash,
              );
              if (!current || current.expiresAt <= Date.now()) {
                close();
                return;
              }
            }
            await stream.writeSSE({ event: "ping", data: "{}" });
          })().catch(close);
        }, 20_000);
        close = () => {
          if (closed) return;
          closed = true;
          clearInterval(keepAlive);
          unsubscribe();
          resolve();
        };
        if (context.req.raw.signal.aborted) close();
        else
          context.req.raw.signal.addEventListener("abort", close, {
            once: true,
          });
      });
    }),
  );

  app.post(
    "/api/interactions/:id",
    tbValidator("json", InteractionBody),
    (context) => {
      const accepted = services.interactions.respond(
        context.req.param("id"),
        context.req.valid("json").value,
      );
      return accepted
        ? context.json({ ok: true })
        : context.json(apiError("not_found"), 404);
    },
  );

  app.get("/api/models", async (context) => {
    const activeModel = services.pi.activeSession.model;
    const current = activeModel
      ? {
          id: activeModel.id,
          name: activeModel.name,
          provider: activeModel.provider,
        }
      : undefined;
    return context.json({
      current,
      thinkingLevel: services.pi.activeSession.thinkingLevel,
      thinkingLevels: activeModel
        ? getSupportedThinkingLevels(activeModel)
        : ["off"],
      authPending: services.pi.providerLoginPending,
      models: services.pi.models().map((model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        api: model.api,
        reasoning: model.reasoning,
        input: model.input,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      })),
      providers: await services.pi.providerAccess(),
    });
  });
  app.get("/api/provider-auth", (context) =>
    context.json(services.pi.providerAuthTask() ?? null),
  );
  app.delete("/api/provider-auth", (context) => {
    services.pi.dismissProviderAuthTask();
    return context.body(null, 204);
  });
  app.put("/api/model", tbValidator("json", ModelBody), async (context) => {
    try {
      const body = context.req.valid("json");
      await services.pi.setModel(body.provider, body.modelId);
      return context.json({ ok: true });
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  app.put("/api/thinking", tbValidator("json", ThinkingBody), (context) => {
    try {
      services.pi.setThinkingLevel(
        context.req.valid("json").level as ThinkingLevel,
      );
      return context.json({ ok: true });
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  app.post(
    "/api/providers/:id/login",
    tbValidator("json", ProviderLoginBody),
    async (context) => {
      try {
        const body = context.req.valid("json");
        if (body.type === "oauth" && body.apiKey !== undefined)
          return context.json(apiError("bad_request"), 400);
        await services.pi.providerLogin(
          context.req.param("id"),
          body.type,
          body.apiKey,
        );
        return context.json({ ok: true });
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.post("/api/providers/login/cancel", async (context) => {
    await services.pi.cancelProviderLogin();
    return context.json({ ok: true });
  });
  app.post("/api/providers/:id/logout", async (context) => {
    try {
      await services.pi.providerLogout(context.req.param("id"));
      return context.json({ ok: true });
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  app.get("/api/commands", (context) => context.json(services.pi.commands()));
  app.get("/api/diagnostics", (context) =>
    context.json({
      ...services.pi.diagnostics(),
      mcp: services.mcp.diagnostics(),
    }),
  );

  app.get("/api/documents/:kind", async (context) => {
    try {
      const kind = documentKind(context.req.param("kind"));
      return context.json({
        content: (await services.resources.readDocument(kind)) ?? "",
      });
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  app.put(
    "/api/documents/:kind",
    tbValidator("json", DocumentBody),
    async (context) => {
      try {
        const kind = documentKind(context.req.param("kind"));
        await services.resources.writeDocument(
          kind,
          undefined,
          context.req.valid("json").content,
        );
        if (kind === "heartbeat") await services.heartbeat.start();
        return context.json({ ok: true });
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.get("/api/templates", async (context) =>
    context.json(await services.resources.listTemplates()),
  );
  app.put(
    "/api/templates/:name",
    tbValidator("json", DocumentBody),
    async (context) => {
      try {
        await services.resources.writeDocument(
          "template",
          context.req.param("name"),
          context.req.valid("json").content,
        );
        return context.json({ ok: true });
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.delete("/api/templates/:name", async (context) => {
    try {
      await services.resources.deleteDocument(
        "template",
        context.req.param("name"),
      );
      return context.body(null, 204);
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  app.get("/api/packages", (context) =>
    context.json(services.resources.listPackages()),
  );
  app.post(
    "/api/packages",
    tbValidator("json", PackageBody),
    async (context) => {
      try {
        await services.resources.installPackage(
          context.req.valid("json").source,
        );
        return context.json({ ok: true }, 201);
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.delete(
    "/api/packages",
    tbValidator("json", PackageBody),
    async (context) => {
      try {
        const removed = await services.resources.removePackage(
          context.req.valid("json").source,
        );
        return context.json({ removed });
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.post(
    "/api/packages/update",
    tbValidator("json", PackageBody),
    async (context) => {
      try {
        await services.resources.updatePackage(
          context.req.valid("json").source,
        );
        return context.json({ ok: true });
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );

  app.get("/api/mcp", async (context) =>
    context.json(redactMcpConfig(await readMcpConfig(mcpPath))),
  );
  app.put("/api/mcp", tbValidator("json", McpBody), async (context) => {
    try {
      const previous = await readMcpConfig(mcpPath);
      await writeMcpConfig(
        mcpPath,
        context.req.valid("json") as McpConfig,
        previous,
      );
      await services.pi.reload();
      return context.json({
        ok: true,
        diagnostics: services.mcp.diagnostics(),
      });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  app.get("/api/heartbeat", async (context) =>
    context.json({
      config: services.heartbeat.status(),
      runs: await services.store.listHeartbeatRuns(25),
    }),
  );
  app.post("/api/heartbeat/run", async (context) => {
    try {
      await services.heartbeat.runNow();
      return context.json({ ok: true });
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  app.post("/api/heartbeat/stop", async (context) => {
    await services.heartbeat.stop();
    return context.json({ ok: true });
  });
}
