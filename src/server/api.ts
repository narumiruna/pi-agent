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
  isValidPromptName,
  MAX_CHAT_IMAGE_BASE64_LENGTH,
  MAX_CHAT_IMAGES,
  MAX_PROMPT_NAME_LENGTH,
  PROMPT_NAME_PATTERN,
  type WebEvent,
} from "../shared/contracts.js";
import type { PiService } from "./agent/pi-service.js";
import { ProjectTrustDeniedError } from "./agent/project-trust.js";
import { AgentBusyError } from "./agent/run-coordinator.js";
import { projectMcpDiagnostics } from "./api-metadata.js";
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
import {
  ResourceConflictError,
  ResourcePermissionError,
  type ResourceService,
  ResourceValidationError,
} from "./resources/service.js";
import type { AppStore, WebSessionRecord } from "./storage/types.js";
import { WorkspaceError } from "./workspace/errors.js";
import { MAX_WORKSPACE_PATH_LENGTH } from "./workspace/policy.js";
import { searchWorkspace } from "./workspace/search.js";
import type { WorkspaceService } from "./workspace/service.js";

export interface ApiEnv extends Env {
  Variables: { session?: WebSessionRecord };
}

export interface ApiServices {
  config: AppConfig;
  store: AppStore;
  pi: PiService;
  interactions: InteractionBroker;
  resources: ResourceService;
  workspace: WorkspaceService;
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
const ConversationListQuery = Type.Object(
  {
    q: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    name: Type.Optional(
      Type.Union([Type.Literal("all"), Type.Literal("named")]),
    ),
    sort: Type.Optional(
      Type.Union([
        Type.Literal("recent"),
        Type.Literal("relevance"),
        Type.Literal("threaded"),
      ]),
    ),
  },
  { additionalProperties: false },
);
const RenameBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
});
const ComposerBody = Type.Object({
  text: Type.String({ maxLength: 100_000 }),
});
const AgentSettingsBody = Type.Object({
  steeringMode: Type.Optional(
    Type.Union([Type.Literal("all"), Type.Literal("one-at-a-time")]),
  ),
  followUpMode: Type.Optional(
    Type.Union([Type.Literal("all"), Type.Literal("one-at-a-time")]),
  ),
  autoCompaction: Type.Optional(Type.Boolean()),
  autoRetry: Type.Optional(Type.Boolean()),
  activeTools: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
      minItems: 1,
      maxItems: 100,
    }),
  ),
});
const TreeNavigationBody = Type.Object({
  targetId: Type.String({ minLength: 1, maxLength: 200 }),
  summarize: Type.Optional(Type.Boolean()),
  customInstructions: Type.Optional(Type.String({ maxLength: 10_000 })),
  label: Type.Optional(Type.String({ maxLength: 120 })),
});
const ForkBody = Type.Object({
  targetId: Type.String({ minLength: 1, maxLength: 200 }),
  position: Type.Union([Type.Literal("at"), Type.Literal("before")]),
});
const CompactBody = Type.Object({
  customInstructions: Type.Optional(Type.String({ maxLength: 10_000 })),
});
const ImportBody = Type.Object({
  content: Type.String({ minLength: 1, maxLength: 5_000_000 }),
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
const DocumentBody = Type.Object(
  { content: Type.String({ maxLength: 1_000_000 }) },
  { additionalProperties: false },
);
const PromptCreateBody = Type.Object(
  {
    name: Type.String({
      minLength: 1,
      maxLength: MAX_PROMPT_NAME_LENGTH,
      pattern: PROMPT_NAME_PATTERN,
    }),
    content: Type.String({ maxLength: 1_000_000 }),
    scope: Type.Union([Type.Literal("project"), Type.Literal("user")]),
  },
  { additionalProperties: false },
);
const PackageInstallBody = Type.Object(
  {
    source: Type.String({ maxLength: 2_048 }),
    acknowledgeRisk: Type.Literal(true),
  },
  { additionalProperties: false },
);
const PackageTargetBody = Type.Object(
  {
    id: Type.String({ pattern: "^pkg_[A-Za-z0-9_-]{43}$" }),
    acknowledgeRisk: Type.Literal(true),
  },
  { additionalProperties: false },
);
const ProjectTrustBody = Type.Object(
  {
    trusted: Type.Boolean(),
    acknowledgeRisk: Type.Literal(true),
  },
  { additionalProperties: false },
);
const McpBody = Type.Object({
  mcpServers: Type.Record(Type.String(), Type.Unknown()),
});
const WorkspacePathQuery = Type.Object(
  {
    path: Type.Optional(Type.String({ maxLength: MAX_WORKSPACE_PATH_LENGTH })),
  },
  { additionalProperties: false },
);
const WorkspaceWriteBody = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: MAX_WORKSPACE_PATH_LENGTH }),
    content: Type.String({ maxLength: 1_000_000 }),
    revision: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  },
  { additionalProperties: false },
);
const WorkspaceRenameBody = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: MAX_WORKSPACE_PATH_LENGTH }),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    revision: Type.String({ minLength: 1, maxLength: 100 }),
  },
  { additionalProperties: false },
);
const WorkspaceDeleteBody = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: MAX_WORKSPACE_PATH_LENGTH }),
    revision: Type.String({ minLength: 1, maxLength: 100 }),
  },
  { additionalProperties: false },
);

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
  if (
    error instanceof ResourcePermissionError ||
    error instanceof ProjectTrustDeniedError
  )
    return context.json(apiError("forbidden"), 403);
  if (error instanceof ResourceConflictError)
    return context.json(apiError("conflict"), 409);
  if (error instanceof ResourceValidationError)
    return context.json(
      apiError("bad_request", { diagnostic: error.diagnostic }),
      400,
    );
  if (error instanceof DOMException && error.name === "AbortError")
    return context.json(apiError("cancelled"), 400);
  const message = error instanceof Error ? error.message : "";
  if (/not found/i.test(message))
    return context.json(apiError("not_found"), 404);
  if (/no API key|provider is not configured/i.test(message))
    return context.json(apiError("provider_not_configured"), 400);
  if (/active conversation|active chat run|already|in progress/i.test(message))
    return context.json(apiError("conflict"), 409);
  return context.json(apiError("bad_request"), 400);
}

function workspaceErrorResponse<
  E extends Env,
  P extends string,
  I extends Input,
>(context: Context<E, P, I>, error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return context.json(apiError("cancelled"), 400);
  }
  if (!(error instanceof WorkspaceError)) throw error;
  const params = { reason: error.reason };
  switch (error.status) {
    case 403:
      return context.json(apiError("forbidden", params), 403);
    case 404:
      return context.json(apiError("not_found", params), 404);
    case 409:
      return context.json(apiError("conflict", params), 409);
    case 413:
      return context.json(apiError("bad_request", params), 413);
    case 415:
      return context.json(apiError("bad_request", params), 415);
    default:
      return context.json(apiError("bad_request", params), 400);
  }
}

function attachmentHeader(name: string): string {
  const normalized = Buffer.from(name, "utf8").toString("utf8");
  const fallback =
    normalized
      .replace(/[\r\n"\\]/g, "_")
      .replace(/[^\x20-\x7e]/g, "_")
      .slice(0, 120) || "download";
  const encoded = encodeURIComponent(normalized).replace(
    /[!'()*]/g,
    (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Keep Hono route registration centralized so route ordering, shared validators,
 * and cross-route security policy remain auditable; domain logic stays in services.
 */
export function registerApi<E extends ApiEnv>(
  app: Hono<E>,
  services: ApiServices,
): void {
  const mcpPath = join(services.config.agentDir, "mcp.json");

  app.get(
    "/api/conversations",
    tbValidator("query", ConversationListQuery),
    async (context) => {
      const query = context.req.valid("query");
      return context.json(
        await services.pi.listConversations({
          ...(query.q ? { query: query.q } : {}),
          nameFilter: query.name ?? "all",
          sort: query.sort ?? "threaded",
        }),
      );
    },
  );
  app.post("/api/conversations", async (context) => {
    try {
      return context.json({ id: await services.pi.createConversation() }, 201);
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  app.post(
    "/api/conversations/import",
    tbValidator("json", ImportBody),
    async (context) => {
      try {
        const id = await services.pi.importConversation(
          context.req.valid("json").content,
        );
        return context.json({ id }, 201);
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.post("/api/conversations/:id/activate", async (context) => {
    try {
      await services.pi.activateConversation(context.req.param("id"));
      return context.json({ ok: true });
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  app.get("/api/conversations/:id/state", (context) => {
    try {
      return context.json(
        services.pi.conversationState(context.req.param("id")),
      );
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  app.put(
    "/api/conversations/:id/draft",
    tbValidator("json", ComposerBody),
    (context) => {
      try {
        services.pi.setComposerDraft(
          context.req.param("id"),
          context.req.valid("json").text,
        );
        return context.json({ ok: true });
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.get("/api/conversations/:id/export/:format", async (context) => {
    try {
      const format = context.req.param("format");
      if (format !== "html" && format !== "jsonl")
        return context.json(apiError("not_found"), 404);
      const exported = await services.pi.exportConversation(
        context.req.param("id"),
        format,
      );
      return context.body(Uint8Array.from(exported.content), 200, {
        "content-type": exported.contentType,
        "content-disposition": `attachment; filename="${exported.fileName}"`,
        "x-content-type-options": "nosniff",
      });
    } catch (error) {
      return errorResponse(context, error);
    }
  });
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
  app.post(
    "/api/conversations/:id/steer",
    tbValidator("json", MessageBody),
    async (context) => {
      try {
        const body = context.req.valid("json");
        await services.pi.steer(
          context.req.param("id"),
          body.message,
          body.images,
        );
        return context.json({ queued: true }, 202);
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.post(
    "/api/conversations/:id/follow-up",
    tbValidator("json", MessageBody),
    async (context) => {
      try {
        const body = context.req.valid("json");
        await services.pi.followUp(
          context.req.param("id"),
          body.message,
          body.images,
        );
        return context.json({ queued: true }, 202);
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.delete("/api/conversations/:id/queue", (context) => {
    try {
      return context.json(services.pi.clearQueue(context.req.param("id")));
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  app.post(
    "/api/conversations/:id/tree/navigate",
    tbValidator("json", TreeNavigationBody),
    async (context) => {
      try {
        const { targetId, ...options } = context.req.valid("json");
        return context.json(
          await services.pi.navigateConversationTree(
            context.req.param("id"),
            targetId,
            options,
          ),
        );
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.post(
    "/api/conversations/:id/fork",
    tbValidator("json", ForkBody),
    async (context) => {
      try {
        const body = context.req.valid("json");
        return context.json(
          await services.pi.forkConversation(
            context.req.param("id"),
            body.targetId,
            body.position,
          ),
          201,
        );
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.post(
    "/api/conversations/:id/compact",
    tbValidator("json", CompactBody),
    async (context) => {
      try {
        return context.json(
          await services.pi.compactConversation(
            context.req.param("id"),
            context.req.valid("json").customInstructions,
          ),
        );
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.post("/api/runs/abort", async (context) =>
    context.json({ ok: true, queue: await services.pi.abort() }),
  );

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
      let writes = Promise.resolve();
      const writeEvent = (event: WebEvent) =>
        stream.writeSSE({
          id: String(event.id),
          event: event.type,
          data: JSON.stringify(event.data),
        });
      const unsubscribe = services.pi.events.subscribe((event) => {
        if (!live) queued.push(event);
        else {
          writes = writes.then(() => writeEvent(event));
          void writes.catch(close);
        }
      });
      services.interactions.replayPending((data) =>
        queued.push({ id: initialCursor, type: "interaction", data }),
      );
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

  app.get("/api/models", async (context) =>
    context.json(
      await services.pi.readResourceSnapshot(async () => {
        const activeModel = services.pi.activeSession.model;
        const current = activeModel
          ? {
              id: activeModel.id,
              name: activeModel.name,
              provider: activeModel.provider,
            }
          : undefined;
        return {
          current,
          thinkingLevel: services.pi.activeSession.thinkingLevel,
          thinkingLevels: activeModel
            ? getSupportedThinkingLevels(activeModel)
            : ["off"],
          authPending: services.pi.providerLoginPending,
          projectTrust: services.pi.projectTrust(),
          agent: services.pi.preferences(),
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
        };
      }),
    ),
  );
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
  app.put(
    "/api/agent-settings",
    tbValidator("json", AgentSettingsBody),
    (context) => {
      try {
        return context.json(
          services.pi.setPreferences(context.req.valid("json")),
        );
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.post("/api/reload", async (context) => {
    try {
      await services.pi.reload();
      return context.json({ ok: true });
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  app.get("/api/project-trust", async (context) =>
    context.json(
      await services.pi.readResourceSnapshot(() => services.pi.projectTrust()),
    ),
  );
  app.put(
    "/api/project-trust",
    tbValidator("json", ProjectTrustBody),
    async (context) => {
      try {
        return context.json(
          await services.pi.setProjectTrust(context.req.valid("json").trusted),
        );
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.get("/api/prompt-inventory", async (context) =>
    context.json(
      await services.pi.readResourceSnapshot(async () => {
        const [prompts, diagnostics] = await Promise.all([
          services.resources.listPromptResources(),
          services.resources.listPromptDiagnostics(),
        ]);
        return {
          prompts,
          diagnostics,
          projectTrust: services.pi.projectTrust(),
        };
      }),
    ),
  );
  app.get("/api/commands", async (context) =>
    context.json(
      await services.pi.readResourceSnapshot(async () =>
        services.pi.commands(await services.resources.listPromptResources()),
      ),
    ),
  );
  app.get("/api/workspace/files", async (context) => {
    const query = context.req.query("q") ?? "";
    const rawLimit = Number(context.req.query("limit") ?? "20");
    if (!Number.isInteger(rawLimit))
      return context.json(apiError("bad_request"), 400);
    try {
      return context.json(
        await searchWorkspace(services.config.workspace, query, {
          excludePaths: [services.config.agentDir, services.config.dataDir],
          limit: rawLimit,
          signal: context.req.raw.signal,
        }),
      );
    } catch (error) {
      if (context.req.raw.signal.aborted)
        return context.json(apiError("cancelled"), 400);
      return workspaceErrorResponse(context, error);
    }
  });
  app.get(
    "/api/workspace/entries",
    tbValidator("query", WorkspacePathQuery, (result, context) => {
      if (!result.success) return context.json(apiError("bad_request"), 400);
    }),
    async (context) => {
      try {
        return context.json(
          await services.workspace.listDirectory(
            context.req.valid("query").path ?? "",
            context.req.raw.signal,
          ),
        );
      } catch (error) {
        return workspaceErrorResponse(context, error);
      }
    },
  );
  app.get(
    "/api/workspace/file",
    tbValidator("query", WorkspacePathQuery, (result, context) => {
      if (!result.success) return context.json(apiError("bad_request"), 400);
    }),
    async (context) => {
      const path = context.req.valid("query").path;
      if (!path) return context.json(apiError("bad_request"), 400);
      try {
        return context.json(
          await services.workspace.inspectFile(path, context.req.raw.signal),
        );
      } catch (error) {
        return workspaceErrorResponse(context, error);
      }
    },
  );
  app.put(
    "/api/workspace/file",
    tbValidator("json", WorkspaceWriteBody, (result, context) => {
      if (!result.success) return context.json(apiError("bad_request"), 400);
    }),
    async (context) => {
      const body = context.req.valid("json");
      try {
        return context.json(
          await services.workspace.writeFile(body),
          body.revision === undefined ? 201 : 200,
        );
      } catch (error) {
        return workspaceErrorResponse(context, error);
      }
    },
  );
  app.patch(
    "/api/workspace/file",
    tbValidator("json", WorkspaceRenameBody, (result, context) => {
      if (!result.success) return context.json(apiError("bad_request"), 400);
    }),
    async (context) => {
      try {
        return context.json(
          await services.workspace.renameFile(context.req.valid("json")),
        );
      } catch (error) {
        return workspaceErrorResponse(context, error);
      }
    },
  );
  app.delete(
    "/api/workspace/file",
    tbValidator("json", WorkspaceDeleteBody, (result, context) => {
      if (!result.success) return context.json(apiError("bad_request"), 400);
    }),
    async (context) => {
      try {
        await services.workspace.deleteFile(context.req.valid("json"));
        return context.body(null, 204);
      } catch (error) {
        return workspaceErrorResponse(context, error);
      }
    },
  );
  app.get(
    "/api/workspace/download",
    tbValidator("query", WorkspacePathQuery, (result, context) => {
      if (!result.success) return context.json(apiError("bad_request"), 400);
    }),
    async (context) => {
      const path = context.req.valid("query").path;
      if (!path) return context.json(apiError("bad_request"), 400);
      try {
        const download = await services.workspace.downloadFile(
          path,
          context.req.raw.signal,
        );
        return context.body(download.stream, 200, {
          "content-disposition": attachmentHeader(download.name),
          "content-length": String(download.size),
          "content-type": "application/octet-stream",
          "x-content-type-options": "nosniff",
        });
      } catch (error) {
        return workspaceErrorResponse(context, error);
      }
    },
  );
  app.get("/api/diagnostics", (context) =>
    context.json({
      mcp: projectMcpDiagnostics(services.mcp.diagnostics()),
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
  app.get("/api/prompts", async (context) => {
    try {
      return context.json(
        await services.pi.readResourceSnapshot(() =>
          services.resources.listPromptResources(),
        ),
      );
    } catch (error) {
      return errorResponse(context, error);
    }
  });
  app.post(
    "/api/prompts",
    tbValidator("json", PromptCreateBody),
    async (context) => {
      try {
        const body = context.req.valid("json");
        if (!isValidPromptName(body.name))
          return context.json(apiError("bad_request"), 400);
        await services.resources.createPromptResource(
          body.scope,
          body.name,
          body.content,
        );
        return context.json({ ok: true }, 201);
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.put(
    "/api/prompts/:id",
    tbValidator("json", DocumentBody),
    async (context) => {
      try {
        await services.resources.updatePromptResource(
          context.req.param("id"),
          context.req.valid("json").content,
        );
        return context.json({ ok: true });
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.delete("/api/prompts/:id", async (context) => {
    try {
      await services.resources.deletePromptResource(context.req.param("id"));
      return context.body(null, 204);
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  app.get("/api/templates", async (context) =>
    context.json(
      await services.pi.readResourceSnapshot(() =>
        services.resources.listTemplates(),
      ),
    ),
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
    tbValidator("json", PackageInstallBody),
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
    tbValidator("json", PackageTargetBody),
    async (context) => {
      try {
        const removed = await services.resources.removePackage(
          context.req.valid("json").id,
        );
        return context.json({ removed });
      } catch (error) {
        return errorResponse(context, error);
      }
    },
  );
  app.post(
    "/api/packages/update",
    tbValidator("json", PackageTargetBody),
    async (context) => {
      try {
        await services.resources.updatePackage(context.req.valid("json").id);
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
        diagnostics: projectMcpDiagnostics(services.mcp.diagnostics()),
      });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  app.get("/api/heartbeat", async (context) => {
    const runs = await services.store.listHeartbeatRuns(25);
    return context.json({
      config: services.heartbeat.status(),
      runs: runs.map((run) => ({
        ...run,
        ...(run.details
          ? {}
          : {
              details: services.pi.heartbeatRunDetails(
                run.startedAt,
                run.finishedAt,
              ),
            }),
      })),
    });
  });
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
