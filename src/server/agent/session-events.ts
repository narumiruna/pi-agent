import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { InteractionBroker } from "../interactions/broker.js";
import {
  createHeadlessTheme,
  createWebExtensionUi,
} from "../interactions/ui.js";
import type { WebExtensionState } from "../interactions/web-state.js";
import type { EventHub } from "./events.js";
import { boundedQueue, projectLiveTool } from "./web-projection.js";

export async function bindWebSessionEvents(options: {
  session: AgentSession;
  events: EventHub;
  interactions: InteractionBroker;
  extensionState: WebExtensionState;
}): Promise<() => void> {
  const { session, events, interactions, extensionState } = options;
  const toolStartedAt = new Map<string, number>();
  extensionState.reset(session.sessionId);
  await session.bindExtensions({
    mode: "rpc",
    uiContext: createWebExtensionUi(
      interactions,
      events,
      extensionState,
      createHeadlessTheme(),
    ),
    abortHandler: () => void session.abort(),
    onError: (error) =>
      events.publish("notification", {
        type: "error",
        message: error.error,
      }),
  });
  return session.subscribe((event) => {
    const sessionId = session.sessionId;
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta")
        events.publish("message_delta", {
          sessionId,
          delta: update.delta,
        });
      else if (update.type === "thinking_start")
        events.publish("thinking_status", {
          sessionId,
          status: "running",
        });
      else if (update.type === "thinking_delta")
        events.publish("thinking_status", {
          sessionId,
          status: "running",
          delta: update.delta,
        });
      else if (update.type === "thinking_end")
        events.publish("thinking_status", {
          sessionId,
          status: "done",
        });
      return;
    }
    if (event.type === "message_end") {
      if (
        event.message.role === "assistant" ||
        event.message.role === "toolResult"
      )
        events.publish("message_complete", {
          sessionId,
          role: event.message.role,
          timestamp: event.message.timestamp,
        });
      return;
    }
    if (event.type === "tool_execution_start") {
      const startedAt = Date.now();
      toolStartedAt.set(event.toolCallId, startedAt);
      events.publish(
        "tool_status",
        projectLiveTool(sessionId, event, startedAt),
      );
      return;
    }
    if (event.type === "tool_execution_update") {
      events.publish(
        "tool_status",
        projectLiveTool(
          sessionId,
          event,
          toolStartedAt.get(event.toolCallId) ?? Date.now(),
        ),
      );
      return;
    }
    if (event.type === "tool_execution_end") {
      events.publish(
        "tool_status",
        projectLiveTool(
          sessionId,
          event,
          toolStartedAt.get(event.toolCallId) ?? Date.now(),
        ),
      );
      toolStartedAt.delete(event.toolCallId);
      return;
    }
    if (event.type === "queue_update") {
      events.publish("queue_update", {
        sessionId,
        steering: boundedQueue(session.getSteeringMessages()),
        followUp: boundedQueue(session.getFollowUpMessages()),
      });
      return;
    }
    if (event.type === "compaction_start") {
      events.publish("agent_status", {
        sessionId,
        kind: "compaction",
        status: "running",
        message: event.reason,
      });
      return;
    }
    if (event.type === "compaction_end") {
      events.publish("agent_status", {
        sessionId,
        kind: "compaction",
        status: event.aborted
          ? "aborted"
          : event.errorMessage
            ? "error"
            : "done",
        ...(event.errorMessage ? { message: event.errorMessage } : {}),
      });
      return;
    }
    if (event.type === "auto_retry_start") {
      events.publish("agent_status", {
        sessionId,
        kind: "retry",
        status: "waiting",
        message: event.errorMessage,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
      });
      return;
    }
    if (event.type === "auto_retry_end") {
      events.publish("agent_status", {
        sessionId,
        kind: "retry",
        status: event.success ? "done" : "error",
        ...(event.finalError ? { message: event.finalError } : {}),
        attempt: event.attempt,
      });
      return;
    }
    if (event.type === "summarization_retry_scheduled") {
      events.publish("agent_status", {
        sessionId,
        kind: "retry",
        status: "waiting",
        message: event.errorMessage,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
      });
      return;
    }
    if (event.type === "summarization_retry_attempt_start") {
      events.publish("agent_status", {
        sessionId,
        kind: "retry",
        status: "running",
        message: event.source,
      });
      return;
    }
    if (event.type === "summarization_retry_finished") {
      events.publish("agent_status", {
        sessionId,
        kind: "retry",
        status: "done",
      });
      return;
    }
    if (event.type === "thinking_level_changed")
      events.publish("agent_status", {
        sessionId,
        kind: "thinking",
        status: "changed",
        message: event.level,
      });
  });
}
