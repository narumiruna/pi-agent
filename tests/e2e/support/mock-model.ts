import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamText } from "hono/streaming";

interface CapturedRequest {
  model: string;
  userMessage: string;
}

interface ChatBody {
  model?: unknown;
  messages?: unknown;
}

function lastUserMessage(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as {
      role?: unknown;
      content?: unknown;
    };
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (!Array.isArray(message.content)) return undefined;
    return message.content
      .map((part) => {
        if (typeof part !== "object" || part === null) return "";
        const value = part as { type?: unknown; text?: unknown };
        return value.type === "text" && typeof value.text === "string"
          ? value.text
          : "";
      })
      .join("");
  }
  return undefined;
}

function completionChunk(id: string, model: string, content: string): string {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
      },
    ],
  })}\n\n`;
}

function finishChunk(id: string, model: string): string {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
  })}\n\ndata: [DONE]\n\n`;
}

export function createModelMock(): Hono {
  const app = new Hono();
  const captured: CapturedRequest[] = [];
  let failNext = false;
  let releaseHeld: (() => void) | undefined;

  app.post("/v1/chat/completions", async (context) => {
    if (context.req.header("authorization") !== "Bearer e2e-key") {
      return context.json({ error: { message: "missing e2e key" } }, 401);
    }
    const body = (await context.req.json()) as ChatBody;
    const model = typeof body.model === "string" ? body.model : undefined;
    const userMessage = lastUserMessage(body.messages);
    if (!model || userMessage === undefined) {
      return context.json({ error: { message: "invalid request" } }, 400);
    }
    captured.push({ model, userMessage });
    if (failNext) {
      failNext = false;
      return context.json({ error: { message: "planned e2e failure" } }, 500);
    }

    const response = userMessage.includes("E2E_HEARTBEAT")
      ? "HEARTBEAT_OK"
      : `E2E ${model}: ${userMessage}`;
    const held = userMessage.includes("E2E_HOLD");
    const splitAt = held ? Math.min(12, response.length) : response.length;
    const first = response.slice(0, splitAt);
    const rest = response.slice(splitAt);
    const id = `chatcmpl-${randomUUID()}`;

    context.header("content-type", "text/event-stream");
    context.header("cache-control", "no-cache");
    return streamText(context, async (stream) => {
      await stream.write(completionChunk(id, model, first));
      if (held) {
        await new Promise<void>((resolve) => {
          releaseHeld = resolve;
        });
        releaseHeld = undefined;
      }
      if (rest) await stream.write(completionChunk(id, model, rest));
      await stream.write(finishChunk(id, model));
    });
  });

  app.post("/__control/fail-next", (context) => {
    failNext = true;
    return context.json({ ok: true });
  });

  app.post("/__control/release", (context) => {
    if (!releaseHeld) return context.json({ error: "not_held" }, 409);
    releaseHeld();
    return context.json({ ok: true });
  });

  app.get("/__control/requests", (context) =>
    context.json({ requests: captured }),
  );

  app.delete("/__control/requests", (context) => {
    captured.length = 0;
    return context.body(null, 204);
  });

  app.post("/__control/model/reset", (context) => {
    failNext = false;
    captured.length = 0;
    releaseHeld?.();
    releaseHeld = undefined;
    return context.json({ ok: true });
  });

  return app;
}
