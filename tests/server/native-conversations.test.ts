import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import { PiService } from "../../src/server/agent/pi-service.js";
import { RunCoordinator } from "../../src/server/agent/run-coordinator.js";

const opaqueId = "opaque.session_id-v3";
const nativePath =
  "/agent/sessions/--workspace--/2026-08-15T00-00-00_opaque.jsonl";

function nativeSession(
  overrides: Partial<
    Awaited<ReturnType<typeof SessionManager.listAll>>[number]
  > = {},
): Awaited<ReturnType<typeof SessionManager.listAll>>[number] {
  return {
    id: opaqueId,
    path: nativePath,
    cwd: "/workspace",
    created: new Date("2026-08-15T00:00:00.000Z"),
    modified: new Date("2026-08-15T01:00:00.000Z"),
    messageCount: 4,
    firstMessage: "hello",
    allMessagesText: "hello world",
    ...overrides,
  };
}

test("projects native SessionManager records with opaque IDs and no paths", async () => {
  const listAll = vi.spyOn(SessionManager, "listAll").mockResolvedValue([
    nativeSession({
      id: "opaque.previous_session-v2",
      path: "/agent/sessions/--workspace--/previous.jsonl",
      name: "Previous session",
      messageCount: 3,
    }),
    nativeSession({ name: "Native session" }),
    nativeSession({
      id: "heartbeat-run",
      path: "/agent/sessions/heartbeat/heartbeat.jsonl",
      messageCount: 2,
      firstMessage: "heartbeat",
      allMessagesText: "heartbeat response",
    }),
  ]);
  const service = Object.create(PiService.prototype) as PiService;
  Object.defineProperties(service, {
    config: { value: { agentDir: "/agent" } },
    runtime: {
      value: {
        session: {
          messages: [],
          sessionId: opaqueId,
          sessionName: "Native session",
        },
      },
    },
  });

  const conversations = await service.listConversations();

  expect(listAll).toHaveBeenCalledOnce();
  expect(conversations).toEqual([
    {
      id: "opaque.previous_session-v2",
      name: "Previous session",
      createdAt: "2026-08-15T00:00:00.000Z",
      modifiedAt: "2026-08-15T01:00:00.000Z",
      messageCount: 3,
      active: false,
    },
    {
      id: opaqueId,
      name: "Native session",
      createdAt: "2026-08-15T00:00:00.000Z",
      modifiedAt: "2026-08-15T01:00:00.000Z",
      messageCount: 4,
      active: true,
    },
  ]);
  expect(JSON.stringify(conversations)).not.toContain("/agent/sessions/");
});

test("resolves an opaque ID to its current native path before switching", async () => {
  vi.spyOn(SessionManager, "listAll").mockResolvedValue([
    nativeSession({
      id: `${opaqueId}-decoy`,
      path: "/agent/sessions/--workspace--/decoy.jsonl",
    }),
    nativeSession(),
  ]);
  const switchSession = vi.fn(async () => undefined);
  const service = Object.create(PiService.prototype) as PiService;
  Object.defineProperties(service, {
    config: { value: { agentDir: "/agent", workspace: "/workspace" } },
    coordinator: { value: new RunCoordinator() },
    runtime: {
      value: {
        session: { sessionId: "current", isIdle: true },
        switchSession,
      },
    },
  });

  await service.activateConversation(opaqueId);

  expect(switchSession).toHaveBeenCalledWith(nativePath, {
    cwdOverride: "/workspace",
  });
});
