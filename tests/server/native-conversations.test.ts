import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      allMessagesText: "PRIVATE_SEARCH_CORPUS",
      parentSessionPath: "/private/parent.jsonl",
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
  expect(JSON.stringify(conversations)).not.toContain("PRIVATE_SEARCH_CORPUS");
  expect(JSON.stringify(conversations)).not.toContain("/workspace");
  expect(JSON.stringify(conversations)).not.toContain("/private/parent.jsonl");
});

test("filters an unpersisted active session without exposing its corpus", async () => {
  const service = Object.create(PiService.prototype) as PiService;
  Object.defineProperties(service, {
    config: { value: { workspace: "/workspace" } },
    nativeSessions: { value: vi.fn(async () => []) },
    runtime: {
      value: {
        session: {
          messages: [
            { role: "user", content: "ephemeral needle", timestamp: 1000 },
            {
              role: "assistant",
              content: [{ type: "text", text: "native response" }],
              timestamp: 2000,
            },
          ],
          sessionId: "ephemeral-session",
          sessionName: undefined,
        },
      },
    },
  });

  const matching = await service.listConversations({
    query: "ephemeral",
    sort: "recent",
  });

  expect(matching).toEqual([
    {
      id: "ephemeral-session",
      createdAt: new Date(1000).toISOString(),
      modifiedAt: new Date(2000).toISOString(),
      messageCount: 2,
      active: true,
    },
  ]);
  expect(JSON.stringify(matching)).not.toContain("ephemeral needle");
  await expect(
    service.listConversations({ nameFilter: "named" }),
  ).resolves.toEqual([]);
});

test("searches a native JSONL without modifying it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-agent-discovery-"));
  try {
    const manager = SessionManager.create("/workspace", directory);
    manager.appendMessage({
      role: "user",
      content: "immutable search marker",
      timestamp: 1000,
    });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "native response" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 2000,
    });
    const path = manager.getSessionFile();
    if (!path) throw new Error("Native session was not persisted");
    const before = await readFile(path, "utf8");
    vi.spyOn(SessionManager, "listAll").mockResolvedValue([
      nativeSession({
        id: manager.getSessionId(),
        path,
        allMessagesText: "immutable search marker",
      }),
    ]);
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      config: { value: { agentDir: "/agent", workspace: "/workspace" } },
      runtime: {
        value: {
          session: { messages: [], sessionId: "unpersisted" },
        },
      },
    });

    await expect(
      service.listConversations({ query: '"immutable search"' }),
    ).resolves.toEqual([
      expect.objectContaining({ id: manager.getSessionId() }),
    ]);
    expect(await readFile(path, "utf8")).toBe(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

  expect(switchSession).toHaveBeenCalledOnce();
  expect(switchSession).toHaveBeenNthCalledWith(1, nativePath, {
    cwdOverride: "/workspace",
  });
});
