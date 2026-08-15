import { writeFileSync } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vitest";
import { EventHub } from "../../src/server/agent/events.js";
import { PiService } from "../../src/server/agent/pi-service.js";
import { RunCoordinator } from "../../src/server/agent/run-coordinator.js";
import { projectTranscript } from "../../src/server/agent/transcript.js";
import { InteractionBroker } from "../../src/server/interactions/broker.js";
import { WebExtensionState } from "../../src/server/interactions/web-state.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("RunCoordinator", () => {
  test("allows exactly one run and becomes reusable after failure", async () => {
    const coordinator = new RunCoordinator();
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = coordinator.run("chat", () => pending);
    await expect(
      coordinator.run("heartbeat", async () => undefined),
    ).rejects.toMatchObject({ code: "agent_busy" });
    release?.();
    await first;
    await expect(
      coordinator.run("chat", async () => undefined),
    ).resolves.toBeUndefined();
  });

  test("aborts the current run through its registered abort function", async () => {
    const abort = vi.fn(async () => undefined);
    const coordinator = new RunCoordinator();
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = coordinator.run("chat", () => pending, abort);

    await coordinator.abort();
    expect(abort).toHaveBeenCalledOnce();
    release?.();
    await run;
  });
});

describe("EventHub", () => {
  test("replays events after an id and bounds retained history", () => {
    const hub = new EventHub(2);
    expect(hub.cursor).toBe(0);
    const one = hub.publish("run_status", { status: "one" });
    const two = hub.publish("run_status", { status: "two" });
    const three = hub.publish("run_status", { status: "three" });

    expect(hub.cursor).toBe(three.id);
    expect(hub.replayAfter(one.id).map((event) => event.data)).toEqual([
      { status: "two" },
      { status: "three" },
    ]);
    expect(hub.replayAfter(two.id).map((event) => event.data)).toEqual([
      { status: "three" },
    ]);
    expect(hub.replayAfter(three.id)).toEqual([]);
  });

  test("marks a stale cursor so clients refresh the transcript", () => {
    const hub = new EventHub(1);
    const old = hub.publish("run_status", { status: "old" });
    hub.publish("run_status", { status: "new" });

    expect(hub.replayAfter(old.id - 1)).toBeUndefined();
  });
});

describe("Pi event bridge", () => {
  test("publishes thinking, tool updates, queue, retry, and completion with session identity", async () => {
    const events = new EventHub();
    const published: Array<{ type: string; data: unknown }> = [];
    events.subscribe((event) => published.push(event));
    let listener: ((event: never) => void) | undefined;
    const session = {
      sessionId: "session",
      bindExtensions: vi.fn(async () => undefined),
      subscribe: vi.fn((next: (event: never) => void) => {
        listener = next;
        return vi.fn();
      }),
      getSteeringMessages: () => ["change direction"],
      getFollowUpMessages: () => ["then test"],
    };
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: events },
      interactions: { value: new InteractionBroker(events) },
      extensionState: { value: new WebExtensionState(events) },
      toolStartedAt: { value: new Map<string, number>() },
    });

    await (
      service as unknown as {
        bindSession(value: typeof session): Promise<void>;
      }
    ).bindSession(session);
    listener?.({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_start" },
    } as never);
    listener?.({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "reason" },
    } as never);
    listener?.({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "echo ok" },
    } as never);
    listener?.({
      type: "tool_execution_update",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "echo ok" },
      partialResult: {
        content: [{ type: "text", text: "ok" }],
        details: {},
      },
    } as never);
    listener?.({
      type: "queue_update",
      steering: ["ignored event copy"],
      followUp: [],
    } as never);
    listener?.({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 10,
      errorMessage: "overloaded at /private/runtime/session.jsonl",
    } as never);
    listener?.({
      type: "message_end",
      message: { role: "assistant", timestamp: 42 },
    } as never);

    expect(published).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "thinking_status",
          data: { sessionId: "session", status: "running", delta: "reason" },
        }),
        expect.objectContaining({
          type: "tool_status",
          data: expect.objectContaining({
            sessionId: "session",
            id: "tool-1",
            output: "ok",
          }),
        }),
        expect.objectContaining({
          type: "queue_update",
          data: {
            sessionId: "session",
            steering: ["change direction"],
            followUp: ["then test"],
          },
        }),
        expect.objectContaining({
          type: "agent_status",
          data: expect.objectContaining({
            sessionId: "session",
            kind: "retry",
            message: "overloaded at <path>",
          }),
        }),
        expect.objectContaining({
          type: "message_complete",
          data: { sessionId: "session", role: "assistant", timestamp: 42 },
        }),
      ]),
    );
  });
});

describe("Pi resource provenance", () => {
  test("preserves native scope and origin for every invokable resource", () => {
    const sourceInfo = (
      scope: "project" | "temporary" | "user",
      origin: "package" | "top-level",
    ) => ({
      path: `/private/${scope}/${origin}`,
      source: "npm:secret-resource",
      scope,
      origin,
    });
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperty(service, "runtime", {
      value: {
        session: {
          promptTemplates: [
            {
              name: "project-prompt",
              description: "Project prompt",
              sourceInfo: sourceInfo("project", "top-level"),
            },
            {
              name: "user-package-prompt",
              description: "User package prompt",
              sourceInfo: sourceInfo("user", "package"),
            },
          ],
        },
        services: {
          resourceLoader: {
            getExtensions: () => ({
              extensions: [
                {
                  commands: new Map([
                    [
                      "user-command",
                      {
                        description: "User command",
                        sourceInfo: sourceInfo("user", "top-level"),
                      },
                    ],
                    [
                      "temporary-command",
                      {
                        description: "Temporary command",
                        sourceInfo: sourceInfo("temporary", "top-level"),
                      },
                    ],
                  ]),
                },
              ],
            }),
            getSkills: () => ({
              skills: [
                {
                  name: "project-package-skill",
                  description: "Project package skill",
                  sourceInfo: sourceInfo("project", "package"),
                },
                {
                  name: "temporary-package-skill",
                  description: "Temporary package skill",
                  sourceInfo: sourceInfo("temporary", "package"),
                },
              ],
            }),
          },
        },
      },
    });

    const commands = service.commands();

    expect(commands).toEqual([
      expect.objectContaining({
        name: "user-command",
        source: "extension",
        provenance: { scope: "user", origin: "top-level" },
      }),
      expect.objectContaining({
        name: "temporary-command",
        source: "extension",
        provenance: { scope: "temporary", origin: "top-level" },
      }),
      expect.objectContaining({
        name: "project-prompt",
        source: "prompt",
        provenance: { scope: "project", origin: "top-level" },
      }),
      expect.objectContaining({
        name: "user-package-prompt",
        source: "prompt",
        provenance: { scope: "user", origin: "package" },
      }),
      expect.objectContaining({
        name: "skill:project-package-skill",
        source: "skill",
        provenance: { scope: "project", origin: "package" },
      }),
      expect.objectContaining({
        name: "skill:temporary-package-skill",
        source: "skill",
        provenance: { scope: "temporary", origin: "package" },
      }),
    ]);
    expect(JSON.stringify(commands)).not.toMatch(/private|secret|sourceInfo/);
  });
});

describe("Pi project trust", () => {
  function trustService(
    options: {
      coordinator?: RunCoordinator;
      persistError?: Error;
      reloadError?: Error;
    } = {},
  ) {
    let trusted = false;
    const waitForIdle = vi.fn(async () => undefined);
    const run = vi.fn(async (_kind: string, task: () => Promise<unknown>) =>
      task(),
    );
    const chatReload = options.reloadError
      ? vi
          .fn<() => Promise<void>>()
          .mockRejectedValueOnce(options.reloadError)
          .mockResolvedValue(undefined)
      : vi.fn(async () => undefined);
    const heartbeatReload = vi.fn(async () => undefined);
    const setProjectTrusted = vi.fn((value: boolean) => {
      trusted = value;
    });
    const persist = options.persistError
      ? vi.fn(() => {
          throw options.persistError;
        })
      : vi.fn();
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      coordinator: {
        value: options.coordinator ?? { waitForIdle, run },
      },
      settingsManager: {
        value: {
          isProjectTrusted: () => trusted,
          setProjectTrusted,
        },
      },
      runtime: { value: { session: { reload: chatReload } } },
      heartbeatSession: { value: { reload: heartbeatReload } },
      projectTrustPolicy: {
        value: {
          status: () => ({ required: true, trusted }),
          persist,
        },
      },
    });
    return {
      service,
      waitForIdle,
      run,
      chatReload,
      heartbeatReload,
      setProjectTrusted,
      persist,
      trusted: () => trusted,
    };
  }

  test("re-resolves native trust before every general resource reload", async () => {
    const waitForIdle = vi.fn(async () => undefined);
    const run = vi.fn(async (_kind: string, task: () => Promise<unknown>) =>
      task(),
    );
    let trusted = true;
    const setProjectTrusted = vi.fn((value: boolean) => {
      trusted = value;
    });
    const refresh = vi.fn(async () => {
      setProjectTrusted(false);
      return { required: true, trusted: false };
    });
    const chatReload = vi.fn(async () => undefined);
    const heartbeatReload = vi.fn(async () => undefined);
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      coordinator: { value: { waitForIdle, run } },
      settingsManager: {
        value: { isProjectTrusted: () => trusted, setProjectTrusted },
      },
      projectTrustPolicy: { value: { refresh } },
      runtime: { value: { session: { reload: chatReload } } },
      heartbeatSession: { value: { reload: heartbeatReload } },
    });

    await service.reload();

    expect(waitForIdle).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("maintenance", expect.any(Function));
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
      chatReload.mock.invocationCallOrder[0] ?? 0,
    );
    expect(chatReload).toHaveBeenCalledOnce();
    expect(heartbeatReload).toHaveBeenCalledOnce();
    expect(trusted).toBe(false);
  });

  test("restores runtime trust when a general reload fails", async () => {
    let trusted = true;
    const setProjectTrusted = vi.fn((value: boolean) => {
      trusted = value;
    });
    const chatReload = vi.fn(async () => undefined);
    const heartbeatReload = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("heartbeat reload failed"))
      .mockResolvedValue(undefined);
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      coordinator: { value: new RunCoordinator() },
      settingsManager: {
        value: { isProjectTrusted: () => trusted, setProjectTrusted },
      },
      projectTrustPolicy: {
        value: {
          refresh: async () => {
            setProjectTrusted(false);
          },
        },
      },
      runtime: { value: { session: { reload: chatReload } } },
      heartbeatSession: { value: { reload: heartbeatReload } },
    });

    await expect(service.reload()).rejects.toThrow("heartbeat reload failed");

    expect(setProjectTrusted).toHaveBeenNthCalledWith(1, false);
    expect(setProjectTrusted).toHaveBeenNthCalledWith(2, true);
    expect(chatReload).toHaveBeenCalledTimes(2);
    expect(heartbeatReload).toHaveBeenCalledTimes(2);
    expect(trusted).toBe(true);
  });

  test("holds a maintenance lease after waiting for an active run", async () => {
    const coordinator = new RunCoordinator();
    let releaseRun: (() => void) | undefined;
    const activeRun = coordinator.run(
      "chat",
      () =>
        new Promise<void>((resolve) => {
          releaseRun = resolve;
        }),
    );
    const state = trustService({ coordinator });

    const change = state.service.setProjectTrust(true);
    await vi.waitFor(() => expect(releaseRun).toBeDefined());
    await Promise.resolve();
    expect(state.setProjectTrusted).not.toHaveBeenCalled();
    releaseRun?.();
    await activeRun;
    await change;

    expect(state.setProjectTrusted).toHaveBeenCalledWith(true);
    expect(coordinator.isIdle).toBe(true);
  });

  test("waits for idle, reloads both sessions, and then persists trust", async () => {
    const state = trustService();

    await expect(state.service.setProjectTrust(true)).resolves.toEqual({
      required: true,
      trusted: true,
    });

    expect(state.waitForIdle).toHaveBeenCalledOnce();
    expect(state.run).toHaveBeenCalledWith("maintenance", expect.any(Function));
    expect(state.setProjectTrusted).toHaveBeenCalledWith(true);
    expect(state.chatReload).toHaveBeenCalledOnce();
    expect(state.heartbeatReload).toHaveBeenCalledOnce();
    expect(state.persist).toHaveBeenCalledWith(true);
    expect(state.persist.mock.invocationCallOrder[0]).toBeGreaterThan(
      state.heartbeatReload.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test("restores untrusted runtime state when reload fails", async () => {
    const state = trustService({ reloadError: new Error("reload failed") });

    await expect(state.service.setProjectTrust(true)).rejects.toThrow(
      "reload failed",
    );

    expect(state.setProjectTrusted).toHaveBeenNthCalledWith(1, true);
    expect(state.setProjectTrusted).toHaveBeenNthCalledWith(2, false);
    expect(state.persist).not.toHaveBeenCalled();
    expect(state.chatReload).toHaveBeenCalledTimes(2);
    expect(state.heartbeatReload).toHaveBeenCalledOnce();
    expect(state.trusted()).toBe(false);
  });

  test("restores untrusted runtime state when persistence fails", async () => {
    const state = trustService({ persistError: new Error("store failed") });

    await expect(state.service.setProjectTrust(true)).rejects.toThrow(
      "store failed",
    );

    expect(state.setProjectTrusted).toHaveBeenNthCalledWith(1, true);
    expect(state.setProjectTrusted).toHaveBeenNthCalledWith(2, false);
    expect(state.chatReload).toHaveBeenCalledTimes(2);
    expect(state.heartbeatReload).toHaveBeenCalledTimes(2);
    expect(state.trusted()).toBe(false);
  });
});

describe("conversation listing", () => {
  test("includes the active in-memory conversation before Pi persists it", async () => {
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      config: { value: { workspace: "/workspace" } },
      nativeSessions: { value: vi.fn(async () => []) },
      runtime: {
        value: {
          session: {
            messages: [],
            sessionId: "active-session",
            sessionName: undefined,
          },
        },
      },
    });

    await expect(service.listConversations()).resolves.toEqual([
      expect.objectContaining({
        id: "active-session",
        active: true,
        messageCount: 0,
      }),
    ]);
  });
});

describe("native session operations", () => {
  test("forks through AgentSessionRuntime, switches IDs, and seeds the new editor state", async () => {
    let session = {
      sessionId: "session",
      isIdle: true,
      sessionManager: { getEntry: () => ({ id: "entry" }) },
    };
    const fork = vi.fn(async () => {
      session = {
        sessionId: "forked",
        isIdle: true,
        sessionManager: { getEntry: () => ({ id: "entry" }) },
      };
      return {
        cancelled: false,
        selectedText: "edit this",
      };
    });
    const setEditorText = vi.fn();
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      coordinator: { value: new RunCoordinator() },
      extensionState: { value: { setEditorText } },
      runtime: {
        value: {
          get session() {
            return session;
          },
          fork,
        },
      },
    });

    await expect(
      service.forkConversation("session", "entry", "before"),
    ).resolves.toEqual({ id: "forked", selectedText: "edit this" });
    expect(fork).toHaveBeenCalledWith("entry", { position: "before" });
    expect(setEditorText).toHaveBeenCalledWith("edit this", "replace");
  });

  test("renames and deletes an inactive native session without activating it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-agent-manage-"));
    temporaryDirectories.push(directory);
    const manager = SessionManager.create("/workspace", directory);
    manager.appendMessage({
      role: "user",
      content: "manage me",
      timestamp: 1,
    });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "persisted" }],
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
      timestamp: 2,
    });
    const path = manager.getSessionFile();
    if (!path) throw new Error("Session was not persisted");
    const before = await readFile(path, "utf8");
    const setSessionName = vi.fn();
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      coordinator: { value: new RunCoordinator() },
      nativeSessions: {
        value: vi.fn(async () => [{ id: manager.getSessionId(), path }]),
      },
      runtime: {
        value: {
          session: {
            sessionId: "active-session",
            isIdle: true,
            setSessionName,
          },
        },
      },
    });

    await service.renameConversation(manager.getSessionId(), "  Renamed  ");

    expect(service.activeSessionId).toBe("active-session");
    expect(setSessionName).not.toHaveBeenCalled();
    expect(SessionManager.open(path).getSessionName()).toBe("Renamed");
    const renamed = await readFile(path, "utf8");
    expect(renamed.startsWith(before)).toBe(true);
    expect(() =>
      renamed
        .trim()
        .split("\n")
        .forEach((line) => {
          JSON.parse(line);
        }),
    ).not.toThrow();

    await service.deleteConversation(manager.getSessionId());

    expect(service.activeSessionId).toBe("active-session");
    await expect(access(path)).rejects.toThrow();
  });

  test("holds the coordinator and rechecks active identity before deletion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-agent-delete-race-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "target.jsonl");
    await writeFile(path, "session\n");
    let releaseList: (() => void) | undefined;
    let markListStarted: (() => void) | undefined;
    const listStarted = new Promise<void>((resolve) => {
      markListStarted = resolve;
    });
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    let activeId = "current";
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      coordinator: { value: new RunCoordinator() },
      nativeSessions: {
        value: vi.fn(async () => {
          markListStarted?.();
          await listGate;
          return [{ id: "target", path }];
        }),
      },
      runtime: {
        value: {
          get session() {
            return { sessionId: activeId, isIdle: true };
          },
        },
      },
    });

    const deletion = service.deleteConversation("target");
    await listStarted;
    await expect(service.activateConversation("target")).rejects.toMatchObject({
      code: "agent_busy",
    });
    activeId = "target";
    releaseList?.();

    await expect(deletion).rejects.toThrow(/active conversation/i);
    await expect(access(path)).resolves.toBeUndefined();
  });

  test("renames the active session through AgentSession and rejects deleting it", async () => {
    const setSessionName = vi.fn();
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      coordinator: { value: new RunCoordinator() },
      runtime: {
        value: {
          session: { sessionId: "active", isIdle: true, setSessionName },
        },
      },
    });

    await service.renameConversation("active", "Active name");

    expect(setSessionName).toHaveBeenCalledWith("Active name");
    await expect(service.deleteConversation("active")).rejects.toThrow(
      /active conversation/i,
    );
  });

  test("surfaces native cancellation without replacing the active session", async () => {
    const newSession = vi.fn(async () => ({ cancelled: true }));
    const switchSession = vi.fn(async () => ({ cancelled: true }));
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      config: { value: { workspace: "/workspace" } },
      coordinator: { value: new RunCoordinator() },
      nativeSessions: {
        value: vi.fn(async () => [{ id: "target", path: "/session.jsonl" }]),
      },
      runtime: {
        value: {
          session: { sessionId: "active", isIdle: true },
          newSession,
          switchSession,
        },
      },
    });

    await expect(service.createConversation()).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(service.activateConversation("target")).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(service.activeSessionId).toBe("active");
  });

  test("keeps the original JSONL unchanged when Pi creates a branch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-agent-session-"));
    temporaryDirectories.push(directory);
    const manager = SessionManager.create("/workspace", directory);
    manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "original" }],
      timestamp: 1,
    });
    const assistantId = manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "response" }],
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
      timestamp: 2,
    });
    const originalPath = manager.getSessionFile();
    if (!originalPath) throw new Error("Session was not persisted");
    const before = await readFile(originalPath, "utf8");

    const branchPath = manager.createBranchedSession(assistantId);

    expect(branchPath).toBeDefined();
    expect(await readFile(originalPath, "utf8")).toBe(before);
    expect(await readFile(branchPath as string, "utf8")).toContain("original");
  });

  test("rejects every idle-guarded operation while the coordinator has an active run", async () => {
    const coordinator = new RunCoordinator();
    let release: (() => void) | undefined;
    const active = coordinator.run(
      "chat",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const guardedAction = vi.fn();
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      coordinator: { value: coordinator },
      runtime: {
        value: {
          session: {
            sessionId: "session",
            isIdle: true,
            setAutoRetryEnabled: guardedAction,
            sessionManager: { getEntry: guardedAction },
            navigateTree: guardedAction,
            compact: guardedAction,
          },
          fork: guardedAction,
          importFromJsonl: guardedAction,
          newSession: guardedAction,
        },
      },
    });
    const operations: Array<[string, () => unknown]> = [
      ["activate", () => service.activateConversation("other")],
      ["create", () => service.createConversation()],
      ["rename", () => service.renameConversation("session", "name")],
      ["delete", () => service.deleteConversation("other")],
      ["preferences", () => service.setPreferences({ autoRetry: false })],
      [
        "tree navigation",
        () => service.navigateConversationTree("session", "entry", {}),
      ],
      ["fork", () => service.forkConversation("session", "entry", "at")],
      ["compact", () => service.compactConversation("session")],
      ["export", () => service.exportConversation("session", "jsonl")],
      ["import", () => service.importConversation('{"type":"session"}\n')],
    ];

    for (const [name, operation] of operations) {
      await expect(
        Promise.resolve().then(operation),
        `${name} should reject while the agent is busy`,
      ).rejects.toMatchObject({ code: "agent_busy" });
    }
    expect(guardedAction).not.toHaveBeenCalled();
    release?.();
    await active;
  });

  test("rejects an idle-guarded mutation while the native session is busy", async () => {
    const guardedAction = vi.fn();
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      coordinator: { value: new RunCoordinator() },
      runtime: {
        value: {
          session: {
            sessionId: "session",
            isIdle: false,
            setAutoRetryEnabled: guardedAction,
          },
        },
      },
    });

    await expect(
      Promise.resolve().then(() =>
        service.setPreferences({ autoRetry: false }),
      ),
    ).rejects.toMatchObject({ code: "agent_busy" });
    expect(guardedAction).not.toHaveBeenCalled();
  });

  test("imports validated JSONL through a private temporary file", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-agent-import-"));
    temporaryDirectories.push(dataDir);
    let session = { sessionId: "current", isIdle: true };
    let importedPath: string | undefined;
    const runtime = {
      get session() {
        return session;
      },
      importFromJsonl: vi.fn(async (path: string, cwd: string) => {
        importedPath = path;
        expect(path.startsWith(dataDir)).toBe(true);
        expect(cwd).toBe("/workspace");
        session = { sessionId: "imported", isIdle: true };
        return { cancelled: false };
      }),
    };
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      config: { value: { dataDir, workspace: "/workspace" } },
      coordinator: { value: new RunCoordinator() },
      runtime: { value: runtime },
      nativeSessions: { value: vi.fn(async () => []) },
    });
    const content = `${JSON.stringify({
      type: "session",
      version: 3,
      id: "imported",
      timestamp: new Date(0).toISOString(),
      cwd: "/private/source",
    })}\n`;

    await expect(service.importConversation(content)).resolves.toBe("imported");
    expect(importedPath).toBeDefined();
    await expect(access(importedPath as string)).rejects.toThrow();
  });

  test("rejects malformed and duplicate session imports before writing", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-agent-import-"));
    temporaryDirectories.push(dataDir);
    const importFromJsonl = vi.fn();
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      config: { value: { dataDir, workspace: "/workspace" } },
      coordinator: { value: new RunCoordinator() },
      runtime: {
        value: {
          session: { sessionId: "current", isIdle: true },
          importFromJsonl,
        },
      },
      nativeSessions: {
        value: vi.fn(async () => [{ id: "duplicate" }]),
      },
    });

    await expect(service.importConversation("not jsonl")).rejects.toThrow();
    await expect(
      service.importConversation(
        `${JSON.stringify({
          type: "session",
          version: 3,
          id: "bad\r\nheader",
          timestamp: new Date(0).toISOString(),
          cwd: "/workspace",
        })}\n`,
      ),
    ).rejects.toThrow(/invalid/i);
    await expect(
      service.importConversation(
        [
          JSON.stringify({
            type: "session",
            version: 3,
            id: "valid-import-id",
            timestamp: new Date(0).toISOString(),
            cwd: "/workspace",
          }),
          JSON.stringify({
            type: "message",
            id: "entry",
            parentId: null,
            timestamp: new Date(0).toISOString(),
          }),
        ].join("\n"),
      ),
    ).rejects.toThrow(/invalid/i);
    await expect(
      service.importConversation(
        `${JSON.stringify({
          type: "session",
          version: 3,
          id: "duplicate",
          timestamp: new Date(0).toISOString(),
          cwd: "/workspace",
        })}\n`,
      ),
    ).rejects.toThrow(/already exists/i);
    expect(importFromJsonl).not.toHaveBeenCalled();
  });

  test("exports through a cleaned temporary path with an opaque filename", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-agent-export-"));
    temporaryDirectories.push(dataDir);
    let outputPath: string | undefined;
    const session = {
      sessionId: "session-secret-path",
      isIdle: true,
      exportToJsonl: (path: string) => {
        outputPath = path;
        return path;
      },
    };
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      config: { value: { dataDir } },
      coordinator: { value: new RunCoordinator() },
      runtime: { value: { session } },
    });
    vi.spyOn(session, "exportToJsonl").mockImplementation((path) => {
      outputPath = path;
      writeFileSync(path, "jsonl");
      return path;
    });

    const exported = await service.exportConversation(
      "session-secret-path",
      "jsonl",
    );

    expect(exported.content.toString()).toBe("jsonl");
    expect(exported.fileName).toBe("conversation-session-secr.jsonl");
    expect(exported.fileName).not.toContain(dataDir);
    await expect(access(outputPath as string)).rejects.toThrow();
  });

  test("applies queue, retry, compaction, and tool settings to AgentSession", () => {
    const setSteeringMode = vi.fn();
    const setFollowUpMode = vi.fn();
    const setAutoCompactionEnabled = vi.fn();
    const setAutoRetryEnabled = vi.fn();
    const setActiveToolsByName = vi.fn();
    const events = new EventHub();
    const session = {
      sessionId: "session",
      isIdle: true,
      steeringMode: "one-at-a-time",
      followUpMode: "all",
      autoCompactionEnabled: false,
      autoRetryEnabled: true,
      getActiveToolNames: () => ["read", "edit"],
      getAllTools: () => [
        { name: "read", description: "Read" },
        { name: "edit", description: "Edit" },
      ],
      setSteeringMode,
      setFollowUpMode,
      setAutoCompactionEnabled,
      setAutoRetryEnabled,
      setActiveToolsByName,
    };
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      coordinator: { value: new RunCoordinator() },
      events: { value: events },
      runtime: { value: { session } },
    });

    service.setPreferences({
      steeringMode: "one-at-a-time",
      followUpMode: "all",
      autoCompaction: false,
      autoRetry: true,
      activeTools: ["read", "edit", "read"],
    });

    expect(setSteeringMode).toHaveBeenCalledWith("one-at-a-time");
    expect(setFollowUpMode).toHaveBeenCalledWith("all");
    expect(setAutoCompactionEnabled).toHaveBeenCalledWith(false);
    expect(setAutoRetryEnabled).toHaveBeenCalledWith(true);
    expect(setActiveToolsByName).toHaveBeenCalledWith(["read", "edit"]);

    vi.clearAllMocks();
    expect(() =>
      service.setPreferences({
        steeringMode: "all",
        activeTools: ["unknown"],
      }),
    ).toThrow(/active tools/i);
    expect(setSteeringMode).not.toHaveBeenCalled();
  });
});

describe("conversation prompting", () => {
  test("sends image attachments through Pi's native prompt options", async () => {
    const prompt = vi.fn(async () => undefined);
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      coordinator: { value: new RunCoordinator() },
      events: { value: new EventHub() },
      runtime: { value: { session: { prompt, abort: vi.fn() } } },
      switchConversation: { value: vi.fn(async () => undefined) },
    });
    const image = {
      type: "image" as const,
      data: "aW1hZ2U=",
      mimeType: "image/png",
    };

    await service.prompt("session", "", [image]);
    await service.coordinator.waitForIdle();

    expect(prompt).toHaveBeenCalledWith("", { images: [image] });
  });

  test("queues steering input on the active Pi session", async () => {
    const coordinator = new RunCoordinator();
    let release: (() => void) | undefined;
    const activeRun = coordinator.run(
      "chat",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const prompt = vi.fn(async () => undefined);
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      coordinator: { value: coordinator },
      runtime: {
        value: {
          session: { sessionId: "session", isStreaming: true, prompt },
        },
      },
    });
    const image = {
      type: "image" as const,
      data: "aW1hZ2U=",
      mimeType: "image/png",
    };

    await service.steer("session", "Change direction", [image]);

    expect(prompt).toHaveBeenCalledWith("Change direction", {
      streamingBehavior: "steer",
      images: [image],
    });
    release?.();
    await activeRun;
  });

  test("queues follow-up input through Pi's native queue", async () => {
    const coordinator = new RunCoordinator();
    let release: (() => void) | undefined;
    const activeRun = coordinator.run(
      "chat",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const prompt = vi.fn(async () => undefined);
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      coordinator: { value: coordinator },
      runtime: {
        value: {
          session: { sessionId: "session", isStreaming: true, prompt },
        },
      },
    });

    await service.followUp("session", "Run tests next");

    expect(prompt).toHaveBeenCalledWith("Run tests next", {
      streamingBehavior: "followUp",
    });
    release?.();
    await activeRun;
  });

  test("restores native queued messages when clearing the queue", () => {
    const events = new EventHub();
    const clearQueue = vi.fn(() => ({
      steering: ["change direction"],
      followUp: ["run tests"],
    }));
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: events },
      runtime: {
        value: {
          session: {
            sessionId: "session",
            clearQueue,
            getSteeringMessages: () => [],
            getFollowUpMessages: () => [],
          },
        },
      },
    });

    expect(service.clearQueue("session")).toEqual({
      queue: { sessionId: "session", steering: [], followUp: [] },
      restored: ["change direction", "run tests"],
    });
  });

  test("rejects steering without an active chat run", async () => {
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      coordinator: { value: new RunCoordinator() },
      runtime: {
        value: {
          session: { sessionId: "session", isStreaming: false },
        },
      },
    });

    await expect(service.steer("session", "Change direction")).rejects.toThrow(
      /active chat run/i,
    );
  });

  test("rejects malformed image data before starting a run", async () => {
    const service = Object.create(PiService.prototype) as PiService;

    await expect(
      service.prompt("session", "", [
        { type: "image", data: "not-base64", mimeType: "image/png" },
      ]),
    ).rejects.toThrow(/image data/i);
  });
});

describe("heartbeat execution", () => {
  test("executes the loaded routine and captures diagnostic details", async () => {
    const messages: Array<Record<string, unknown>> = [];
    const prompt = vi.fn(async () => {
      messages.push(
        {
          role: "assistant",
          timestamp: 1,
          content: [
            { type: "thinking", thinking: "Checking the weather endpoint." },
            {
              type: "toolCall",
              id: "tool-1",
              name: "bash",
              arguments: {
                command: "curl weather.example",
                apiKey: "must-not-leak",
              },
            },
            { type: "text", text: "Weather lookup failed." },
          ],
        },
        {
          role: "toolResult",
          timestamp: 2,
          toolCallId: "tool-1",
          toolName: "bash",
          content: [{ type: "text", text: "connection refused" }],
          isError: true,
        },
      );
    });
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperty(service, "heartbeatSession", {
      value: { prompt, messages },
    });

    await expect(service.runHeartbeat("Check the weather.")).resolves.toEqual({
      response: "Weather lookup failed.",
      details: {
        response: "Weather lookup failed.",
        reasoning: "Checking the weather endpoint.",
        tools: [
          {
            id: "tool-1",
            name: "bash",
            input:
              '{\n  "command": "curl weather.example",\n  "apiKey": "[REDACTED]"\n}',
            output: "connection refused",
            isError: true,
          },
        ],
      },
    });
    expect(prompt).toHaveBeenCalledWith(
      expect.stringContaining("Do not create or modify HEARTBEAT.md"),
    );
    expect(prompt).toHaveBeenCalledWith(
      expect.stringContaining(
        "<heartbeat_routine>\nCheck the weather.\n</heartbeat_routine>",
      ),
    );
  });

  test("attaches partial diagnostics when heartbeat execution throws", async () => {
    const messages: Array<Record<string, unknown>> = [];
    const prompt = vi.fn(async () => {
      messages.push({
        role: "assistant",
        timestamp: 1,
        content: [
          { type: "thinking", thinking: "The provider request failed." },
        ],
      });
      throw new Error("Provider unavailable");
    });
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperty(service, "heartbeatSession", {
      value: { prompt, messages },
    });

    await expect(
      service.runHeartbeat("Check the weather."),
    ).rejects.toMatchObject({
      name: "HeartbeatExecutionError",
      message: "Provider unavailable",
      details: { reasoning: "The provider request failed." },
    });
  });
});

describe("model selection", () => {
  test("only exposes models with configured authentication", () => {
    const available = { provider: "anthropic", id: "available" };
    const unavailable = { provider: "openai", id: "unavailable" };
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperty(service, "modelRuntime", {
      value: {
        getAvailableSnapshot: () => [available],
        getModels: () => [available, unavailable],
      },
    });

    expect(service.models()).toEqual([available]);
  });

  test("does not change the chat model when the heartbeat update fails", async () => {
    const oldModel = { provider: "anthropic", id: "old" };
    const newModel = { provider: "anthropic", id: "new" };
    const chatSetModel = vi.fn(async () => undefined);
    const heartbeatSetModel = vi.fn(async () => {
      throw new Error("heartbeat failed");
    });
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      modelRuntime: { value: { getModel: () => newModel } },
      runtime: {
        value: { session: { model: oldModel, setModel: chatSetModel } },
      },
      heartbeatSession: {
        value: { model: oldModel, setModel: heartbeatSetModel },
      },
    });

    await expect(service.setModel("anthropic", "new")).rejects.toThrow(
      /heartbeat failed/,
    );
    expect(chatSetModel).not.toHaveBeenCalled();
  });

  test("restores the heartbeat model when the chat update fails", async () => {
    const oldModel = { provider: "anthropic", id: "old" };
    const newModel = { provider: "anthropic", id: "new" };
    const heartbeatSetModel = vi.fn(async () => undefined);
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      modelRuntime: { value: { getModel: () => newModel } },
      runtime: {
        value: {
          session: {
            model: oldModel,
            setModel: vi.fn(async () => {
              throw new Error("chat failed");
            }),
          },
        },
      },
      heartbeatSession: {
        value: { model: oldModel, setModel: heartbeatSetModel },
      },
    });

    await expect(service.setModel("anthropic", "new")).rejects.toThrow(
      /chat failed/,
    );
    expect(heartbeatSetModel).toHaveBeenNthCalledWith(1, newModel);
    expect(heartbeatSetModel).toHaveBeenNthCalledWith(2, oldModel);
  });
});

describe("provider access", () => {
  test("reports subscription methods and only allows stored credentials to be removed", async () => {
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperty(service, "modelRuntime", {
      value: {
        getProviders: () => [
          {
            id: "anthropic",
            name: "Anthropic",
            auth: {
              apiKey: { name: "Anthropic API key", login: vi.fn() },
              oauth: {
                name: "Anthropic (Claude Pro/Max)",
                loginLabel: "Sign in with Claude",
                isSubscription: true,
              },
            },
          },
          {
            id: "openai",
            name: "OpenAI",
            auth: { apiKey: { name: "OpenAI API key", login: vi.fn() } },
          },
        ],
        isUsingOAuth: (id: string) => id === "anthropic",
        getProviderAuthStatus: (id: string) =>
          id === "anthropic"
            ? { configured: true, source: "stored" }
            : {
                configured: true,
                source: "environment",
                label: "OPENAI_API_KEY",
              },
        listCredentials: async () => [
          { providerId: "anthropic", type: "oauth" },
        ],
      },
    });

    await expect(service.providerAccess()).resolves.toEqual([
      {
        id: "anthropic",
        name: "Anthropic",
        status: {
          configured: true,
          source: "stored",
          credentialType: "oauth",
          disconnectable: true,
        },
        auth: {
          apiKey: { name: "Anthropic API key" },
          oauth: {
            name: "Anthropic (Claude Pro/Max)",
            loginLabel: "Sign in with Claude",
            subscription: true,
          },
        },
      },
      {
        id: "openai",
        name: "OpenAI",
        status: {
          configured: true,
          source: "environment",
          label: "OPENAI_API_KEY",
          credentialType: "api_key",
          disconnectable: false,
        },
        auth: { apiKey: { name: "OpenAI API key" } },
      },
    ]);
  });

  test("projects a recoverable Codex device-code task without credentials", async () => {
    let finishLogin: (() => void) | undefined;
    const prompt = vi.fn(async () => "device_code");
    const notify = vi.fn();
    const events = new EventHub();
    const published: unknown[] = [];
    events.subscribe((event) => {
      if (event.type === "provider_auth") published.push(event.data);
    });
    const login = vi.fn(
      async (_provider: string, _type: string, auth: AuthInteraction) => {
        expect(
          await auth.prompt({
            type: "select",
            message: "Select OpenAI Codex login method:",
            options: [
              { id: "browser", label: "Browser login" },
              { id: "device_code", label: "Device code login" },
            ],
          }),
        ).toBe("device_code");
        auth.notify({
          type: "device_code",
          userCode: "ABCD-1234",
          verificationUri: "https://auth.openai.com/codex/device",
          expiresInSeconds: 900,
        });
        await new Promise<void>((resolve) => {
          finishLogin = resolve;
        });
        return {
          type: "oauth" as const,
          access: "access-secret",
          refresh: "refresh-secret",
          expires: Date.now() + 3_600_000,
        };
      },
    );
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: events },
      modelRuntime: {
        value: {
          getProviders: () => [{ id: "openai-codex", name: "OpenAI Codex" }],
          login,
        },
      },
      interactions: {
        value: { prompt, notify, cancelAll: vi.fn() },
      },
    });

    const pending = service.providerLogin("openai-codex", "oauth");
    await vi.waitFor(() =>
      expect(service.providerAuthTask()).toMatchObject({
        providerId: "openai-codex",
        providerName: "OpenAI Codex",
        phase: "waiting",
        method: "device_code",
        userCode: "ABCD-1234",
        verificationUri: "https://auth.openai.com/codex/device",
      }),
    );
    expect(JSON.stringify(service.providerAuthTask())).not.toContain("secret");
    expect(published).not.toHaveLength(0);

    finishLogin?.();
    await pending;
    expect(service.providerAuthTask()).toEqual({
      providerId: "openai-codex",
      providerName: "OpenAI Codex",
      phase: "succeeded",
    });
    expect(notify).not.toHaveBeenCalled();
  });

  test("preserves the browser authorization URL across a manual-code prompt", async () => {
    let answerPrompt: ((value: string) => void) | undefined;
    const prompt = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          answerPrompt = resolve;
        }),
    );
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: new EventHub() },
      modelRuntime: {
        value: {
          getProviders: () => [{ id: "openai-codex", name: "OpenAI Codex" }],
          login: async (
            _provider: string,
            _type: string,
            auth: AuthInteraction,
          ) => {
            auth.notify({
              type: "auth_url",
              url: "https://auth.openai.com/oauth/authorize",
              instructions: "Complete login in your browser.",
            });
            await auth.prompt({
              type: "manual_code",
              message: "Paste the authorization code or redirect URL",
              placeholder: "http://localhost:1455/auth/callback",
            });
          },
        },
      },
      interactions: {
        value: { prompt, notify: vi.fn(), cancelAll: vi.fn() },
      },
    });

    const pending = service.providerLogin("openai-codex", "oauth");
    await vi.waitFor(() =>
      expect(service.providerAuthTask()).toMatchObject({
        phase: "waiting",
        method: "browser",
        message: "Paste the authorization code or redirect URL",
        url: "https://auth.openai.com/oauth/authorize",
      }),
    );

    answerPrompt?.("authorization-code");
    await pending;
  });

  test("keeps a safe terminal authentication state for failure and cancellation", async () => {
    const login = vi.fn(async () => {
      throw new Error("token exchange failed: access-secret");
    });
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: new EventHub() },
      modelRuntime: {
        value: {
          getProviders: () => [{ id: "openai-codex", name: "OpenAI Codex" }],
          login,
        },
      },
      interactions: {
        value: { prompt: vi.fn(), notify: vi.fn(), cancelAll: vi.fn() },
      },
    });

    await expect(
      service.providerLogin("openai-codex", "oauth"),
    ).rejects.toThrow();
    expect(service.providerAuthTask()).toMatchObject({
      phase: "failed",
      error: "login_failed",
    });
    expect(JSON.stringify(service.providerAuthTask())).not.toContain(
      "access-secret",
    );

    service.dismissProviderAuthTask();
    expect(service.providerAuthTask()).toBeUndefined();
  });

  test("keeps non-Codex OAuth device-code events provider neutral", async () => {
    let finishLogin: (() => void) | undefined;
    const events = new EventHub();
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: events },
      modelRuntime: {
        value: {
          getProviders: () => [{ id: "radius", name: "Radius" }],
          login: async (
            _provider: string,
            _type: string,
            auth: AuthInteraction,
          ) => {
            auth.notify({
              type: "device_code",
              userCode: "RADIUS-1",
              verificationUri: "https://radius.example/device",
            });
            await new Promise<void>((resolve) => {
              finishLogin = resolve;
            });
          },
        },
      },
      interactions: {
        value: { prompt: vi.fn(), notify: vi.fn(), cancelAll: vi.fn() },
      },
    });

    const pending = service.providerLogin("radius", "oauth");
    await vi.waitFor(() =>
      expect(service.providerAuthTask()).toMatchObject({
        providerId: "radius",
        userCode: "RADIUS-1",
        verificationUri: "https://radius.example/device",
      }),
    );
    finishLogin?.();
    await pending;
  });

  test("does not overwrite a completed OAuth task when an API-key login fails", async () => {
    const login = vi.fn(async (_provider: string, type: string) => {
      if (type === "api_key") throw new Error("Invalid API key");
    });
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: new EventHub() },
      modelRuntime: {
        value: {
          getProviders: () => [
            { id: "openai-codex", name: "OpenAI Codex" },
            { id: "anthropic", name: "Anthropic" },
          ],
          login,
        },
      },
      interactions: {
        value: { prompt: vi.fn(), notify: vi.fn(), cancelAll: vi.fn() },
      },
    });

    await service.providerLogin("openai-codex", "oauth");
    const completedTask = service.providerAuthTask();
    await expect(
      service.providerLogin("anthropic", "api_key", "invalid-key"),
    ).rejects.toThrow("Invalid API key");

    expect(service.providerAuthTask()).toEqual(completedTask);
  });

  test("uses a submitted API key for the first secret prompt without publishing it", async () => {
    const prompt = vi.fn();
    const login = vi.fn(
      async (_provider: string, _type: string, auth: AuthInteraction) => {
        const key = await auth.prompt({ type: "secret", message: "API key" });
        expect(key).toBe("private-key");
      },
    );
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      modelRuntime: { value: { login } },
      interactions: { value: { prompt, notify: vi.fn(), cancelAll: vi.fn() } },
    });

    await service.providerLogin("anthropic", "api_key", "private-key");

    expect(prompt).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalledOnce();
  });

  test("falls back to Pi prompts after consuming a submitted API key", async () => {
    const prompt = vi.fn(async () => "account-id");
    const login = vi.fn(
      async (_provider: string, _type: string, auth: AuthInteraction) => {
        expect(await auth.prompt({ type: "secret", message: "API key" })).toBe(
          "private-key",
        );
        expect(await auth.prompt({ type: "text", message: "Account ID" })).toBe(
          "account-id",
        );
      },
    );
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      modelRuntime: { value: { login } },
      interactions: {
        value: { prompt, notify: vi.fn(), cancelAll: vi.fn() },
      },
    });

    await service.providerLogin("cloudflare", "api_key", "private-key");

    expect(prompt).toHaveBeenCalledOnce();
  });

  test("refuses to remove externally managed credentials", async () => {
    const logout = vi.fn();
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperty(service, "modelRuntime", {
      value: { listCredentials: async () => [], logout },
    });

    await expect(service.providerLogout("openai")).rejects.toThrow(
      /not found/i,
    );
    expect(logout).not.toHaveBeenCalled();
  });

  test("cancels provider authentication without dismissing extension input", async () => {
    const events = new EventHub();
    const interactions = new InteractionBroker(events);
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: events },
      modelRuntime: {
        value: {
          getProviders: () => [{ id: "openai-codex", name: "OpenAI Codex" }],
          login: async (
            _provider: string,
            _type: string,
            auth: AuthInteraction,
          ) => {
            await auth.prompt({
              type: "text",
              message: "Provider authorization code",
            });
          },
        },
      },
      interactions: { value: interactions },
    });

    const extensionInput = interactions.request("input", {
      title: "Extension input",
    });
    const providerLogin = service.providerLogin("openai-codex", "oauth");
    await vi.waitFor(() => expect(interactions.pendingCount).toBe(2));

    const cancellation = service.cancelProviderLogin();
    await expect(providerLogin).rejects.toMatchObject({ name: "AbortError" });
    await cancellation;
    expect(interactions.pendingCount).toBe(1);

    const replayed: Array<{ id: string; title?: string }> = [];
    interactions.replayPending((data) =>
      replayed.push(data as { id: string; title?: string }),
    );
    expect(replayed).toEqual([
      expect.objectContaining({ title: "Extension input" }),
    ]);
    interactions.respond(replayed[0].id, "keep-running");
    await expect(extensionInput).resolves.toBe("keep-running");
  });

  test("waits for provider cleanup before cancellation completes", async () => {
    let finishLogin: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: new EventHub() },
      modelRuntime: {
        value: {
          getProviders: () => [{ id: "openai-codex", name: "OpenAI Codex" }],
          login: async (
            _provider: string,
            _type: string,
            auth: AuthInteraction,
          ) => {
            signal = auth.signal;
            await new Promise<void>((resolve) => {
              finishLogin = resolve;
            });
            if (auth.signal?.aborted) throw auth.signal.reason;
          },
        },
      },
      interactions: {
        value: { prompt: vi.fn(), notify: vi.fn(), cancelAll: vi.fn() },
      },
    });

    const login = service.providerLogin("openai-codex", "oauth");
    await vi.waitFor(() => expect(signal).toBeDefined());
    let cancellationFinished = false;
    const cancellation = Promise.resolve(service.cancelProviderLogin()).then(
      () => {
        cancellationFinished = true;
      },
    );

    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    await Promise.resolve();
    expect(cancellationFinished).toBe(false);

    finishLogin?.();
    await expect(login).rejects.toMatchObject({ name: "AbortError" });
    await cancellation;
    expect(service.providerLoginPending).toBe(false);
  });

  test("serializes authentication and releases the flow after cancellation", async () => {
    let signal: AbortSignal | undefined;
    const login = vi.fn(
      async (_provider: string, _type: string, auth: AuthInteraction) => {
        signal = auth.signal;
        await new Promise<void>((_resolve, reject) => {
          auth.signal?.addEventListener(
            "abort",
            () => reject(auth.signal?.reason),
            { once: true },
          );
        });
      },
    );
    const cancelAll = vi.fn();
    const service = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(service, {
      events: { value: new EventHub() },
      modelRuntime: {
        value: {
          getProviders: () => [{ id: "anthropic", name: "Anthropic" }],
          login,
        },
      },
      interactions: {
        value: { prompt: vi.fn(), notify: vi.fn(), cancelAll },
      },
    });

    const first = service.providerLogin("anthropic", "oauth");
    await vi.waitFor(() => expect(signal).toBeDefined());
    await expect(
      service.providerLogin("openai", "api_key", "key"),
    ).rejects.toThrow(/already in progress/i);

    service.cancelProviderLogin();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelAll).not.toHaveBeenCalled();
    expect(service.providerLoginPending).toBe(false);
  });
});

describe("transcript projection", () => {
  test("keeps semantic message, thinking, and tool content", () => {
    const transcript = projectTranscript([
      {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
        ],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "secret" },
          { type: "text", text: "Hi" },
          {
            type: "toolCall",
            id: "call-1",
            name: "read",
            arguments: { path: "README.md" },
          },
        ],
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
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "file contents" }],
        details: { diff: "+added" },
        isError: false,
        timestamp: 3,
      },
    ]);

    expect(transcript).toMatchObject([
      {
        role: "user",
        text: "Hello",
        images: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
      },
      {
        role: "assistant",
        text: "Hi",
        thinking: "secret",
        tools: [
          {
            id: "call-1",
            name: "read",
            result: { text: "file contents", diff: "+added", isError: false },
          },
        ],
      },
    ]);
  });
});
