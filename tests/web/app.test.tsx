// @vitest-environment jsdom

import { Theme } from "@radix-ui/themes";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  App,
  conversationListPath,
  DEFAULT_CONVERSATION_FILTERS,
  updateLiveTools,
} from "../../src/web/App.js";
import { AuthNotification } from "../../src/web/components/AuthNotification.js";
import { DisconnectProviderDialog } from "../../src/web/components/DisconnectProviderDialog.js";
import { InteractionDialog } from "../../src/web/components/InteractionDialog.js";
import { ModelAccessDialog } from "../../src/web/components/ModelAccessDialog.js";
import { ProviderAuthDialog } from "../../src/web/components/ProviderAuthDialog.js";
import i18n, { setLanguage } from "../../src/web/i18n.js";
import { ChatPage } from "../../src/web/pages/ChatPage.js";
import { HeartbeatPage } from "../../src/web/pages/HeartbeatPage.js";
import { SettingsPage } from "../../src/web/pages/SettingsPage.js";

interface MockCodeEditorProps {
  ariaLabel: string;
  readOnly: boolean;
  value: string;
  onChange: (value: string) => void;
}

interface MockCodeDiffEditorProps {
  modified: string;
  modifiedLabel: string;
  original: string;
  originalLabel: string;
  onModifiedChange: (value: string) => void;
}

vi.mock("../../src/web/components/CodeEditor.js", () => ({
  CodeEditor: ({
    ariaLabel,
    readOnly,
    value,
    onChange,
  }: MockCodeEditorProps) => (
    <textarea
      aria-label={ariaLabel}
      readOnly={readOnly}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  CodeDiffEditor: ({
    modified,
    modifiedLabel,
    original,
    originalLabel,
    onModifiedChange,
  }: MockCodeDiffEditorProps) => (
    <div>
      <textarea aria-label={originalLabel} readOnly value={original} />
      <textarea
        aria-label={modifiedLabel}
        value={modified}
        onChange={(event) => onModifiedChange(event.target.value)}
      />
    </div>
  ),
}));

describe("web application", () => {
  test("builds bounded native conversation discovery queries", () => {
    expect(conversationListPath(DEFAULT_CONVERSATION_FILTERS)).toBe(
      "/api/conversations",
    );
    const path = conversationListPath({
      search: ' navigation "browser tests" ',
      name: "named",
      sort: "relevance",
    });
    const query = new URL(path, "http://localhost").searchParams;

    expect(query.get("q")).toBe('navigation "browser tests"');
    expect(query.get("name")).toBe("named");
    expect(query.get("sort")).toBe("relevance");
    expect(
      new URL(
        conversationListPath({
          ...DEFAULT_CONVERSATION_FILTERS,
          search: "x".repeat(600),
        }),
        "http://localhost",
      ).searchParams.get("q"),
    ).toHaveLength(500);
  });

  test("deduplicates live tool updates and ignores another conversation", () => {
    const initial = [
      {
        sessionId: "session",
        id: "tool",
        name: "bash",
        status: "running" as const,
        startedAt: 1,
        updatedAt: 1,
        durationMs: 0,
      },
    ];
    const updated = updateLiveTools(
      initial,
      {
        ...initial[0],
        status: "done",
        output: "ok",
        updatedAt: 2,
      },
      "session",
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ status: "done", output: "ok" });
    expect(
      updateLiveTools(
        updated,
        { ...updated[0], sessionId: "other", output: "wrong" },
        "session",
      ),
    ).toBe(updated);
  });
  beforeEach(async () => {
    window.history.replaceState(null, "", "/");
    await setLanguage("en");
    vi.stubGlobal("fetch", vi.fn());
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  test("shows a focused OIDC login state for unauthenticated visitors", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<App />);

    expect(
      await screen.findByRole("button", { name: /Pocket ID/i }),
    ).toBeVisible();
    expect(screen.queryByText("Heartbeat")).not.toBeInTheDocument();
  });

  test("switches between English and Traditional Chinese without a reload", async () => {
    await setLanguage("en");
    expect(i18n.t("chat")).toBe("Chats");
    expect(i18n.t("newConversation")).toBe("New conversation");

    await setLanguage("zh-TW");
    expect(i18n.t("chat")).toBe("對話");
    expect(i18n.t("newConversation")).toBe("新增對話");
    expect(window.localStorage.getItem("pi-agent-language")).toBe("zh-TW");
  });

  test("guards dirty Files from navigation and provider completion", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    let providerAuthListener: ((event: MessageEvent) => void) | undefined;
    class FakeEventSource {
      onerror: (() => void) | null = null;
      onopen: (() => void) | null = null;
      addEventListener(type: string, listener: EventListener): void {
        if (type === "provider_auth") {
          providerAuthListener = listener as (event: MessageEvent) => void;
        }
      }
      close(): void {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url === "/api/session")
        return json({ authenticated: true, authDisabled: false, tools: [] });
      if (url === "/api/provider-auth" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url === "/api/provider-auth") return json(null);
      if (url === "/api/conversations" || url === "/api/commands")
        return json([]);
      if (url === "/api/workspace/entries?path=")
        return json({
          path: "",
          entries: [
            {
              path: "notes.txt",
              name: "notes.txt",
              kind: "file",
              modifiedAt: 1,
              size: 5,
            },
          ],
          truncated: false,
          writable: true,
        });
      if (url === "/api/workspace/file?path=notes.txt")
        return json({
          path: "notes.txt",
          name: "notes.txt",
          kind: "file",
          modifiedAt: 1,
          size: 5,
          revision: "revision",
          downloadable: true,
          editable: true,
          writable: true,
          content: "notes",
        });
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Files" }));
    expect(screen.getByRole("heading", { name: "Files" })).toBeVisible();
    expect(window.location.pathname).toBe("/files");
    await user.click(
      await screen.findByRole("button", { name: /notes\.txt/i }),
    );
    const editor = await screen.findByLabelText("Contents of notes.txt");
    await user.type(editor, " changed");

    act(() => window.history.back());
    expect(await screen.findByText("Discard unsaved changes?")).toBeVisible();
    expect(window.location.pathname).toBe("/files");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    act(() =>
      providerAuthListener?.(
        new MessageEvent("provider_auth", {
          data: JSON.stringify({
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "succeeded",
          }),
        }),
      ),
    );
    await user.click(
      await screen.findByRole("button", { name: "Choose a model" }),
    );
    expect(screen.getByText("Discard unsaved changes?")).toBeVisible();
    expect(editor).toHaveValue("notes changed");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Files" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Chats" }));
    expect(screen.getByText("Discard unsaved changes?")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Files" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Chats" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("region", { name: "Chats" })).toBeVisible();
    expect(window.location.pathname).toBe("/chats");
  });

  test("expands heartbeat failure diagnostics", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/documents/heartbeat")
        return new Response(JSON.stringify({ content: "Check weather" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url === "/api/heartbeat")
        return new Response(
          JSON.stringify({
            config: {},
            runs: [
              {
                id: "run",
                startedAt: 1,
                finishedAt: 2,
                status: "attention",
                summary: "Weather lookup failed.",
                details: {
                  response: "The weather service could not be reached.",
                  reasoning: "The request timed out.",
                  tools: [
                    {
                      id: "tool-1",
                      name: "bash",
                      input: "curl weather.example",
                      output: "connection refused",
                      isError: true,
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <HeartbeatPage refresh={0} />
      </Theme>,
    );

    expect(await screen.findByText("Weather lookup failed.")).toBeVisible();
    await user.click(screen.getByText("View details", { selector: "summary" }));
    expect(
      screen.getByText(
        "The run completed, but Pi returned a diagnostic instead of exactly HEARTBEAT_OK.",
      ),
    ).toBeVisible();
    expect(screen.getByText("The request timed out.")).toBeVisible();
    expect(screen.getByText("connection refused")).toBeVisible();
  });

  test("pastes and sends an image-only message", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/conversations/session")
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url === "/api/conversations/session/messages") {
        expect(init?.body).toBe(
          JSON.stringify({
            message: "",
            images: [
              {
                type: "image",
                data: "aW1hZ2U=",
                mimeType: "image/png",
              },
            ],
          }),
        );
        return new Response(JSON.stringify({ runId: "run-1" }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const onRunning = vi.fn();
    const user = userEvent.setup();

    render(
      <Theme>
        <ChatPage
          conversationId="session"
          delta=""
          eventsConnected
          inputDisabled={false}
          liveTools={[]}
          refresh={0}
          running={false}
          onRunning={onRunning}
        />
      </Theme>,
    );
    const input = await screen.findByLabelText(/Ask Pi anything/i);
    const file = new File(["image"], "image.png", { type: "image/png" });
    fireEvent.paste(input, {
      clipboardData: {
        items: [{ kind: "file", getAsFile: () => file }],
      },
    });

    expect(
      await screen.findByRole("img", { name: "Attached image 1" }),
    ).toBeVisible();
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeEnabled();
    await user.click(send);

    await waitFor(() => expect(onRunning).toHaveBeenCalledWith(true));
  });

  test("keeps images in the composer instead of putting them in Pi's text queue", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/conversations/session")
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <ChatPage
          conversationId="session"
          delta="Working"
          eventsConnected
          inputDisabled={false}
          liveTools={[]}
          refresh={0}
          running
          onRunning={vi.fn()}
        />
      </Theme>,
    );
    const input = await screen.findByLabelText(/Ask Pi anything/i);
    const file = new File(["image"], "image.png", { type: "image/png" });
    fireEvent.paste(input, {
      clipboardData: {
        items: [{ kind: "file", getAsFile: () => file }],
      },
    });
    await screen.findByRole("img", { name: "Attached image 1" });
    await user.click(screen.getByRole("button", { name: "Steer" }));

    expect(
      screen.getByText("Wait for the current response before sending images."),
    ).toBeVisible();
    expect(screen.getByRole("img", { name: "Attached image 1" })).toBeVisible();
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/conversations/session/steer",
      expect.anything(),
    );
  });

  test("sends steering input while a conversation run is active", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/conversations/session")
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url === "/api/conversations/session/steer") {
        expect(init?.body).toBe(
          JSON.stringify({ message: "Change direction" }),
        );
        return new Response(JSON.stringify({ queued: true }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const onRunning = vi.fn();
    const user = userEvent.setup();

    render(
      <Theme>
        <ChatPage
          conversationId="session"
          delta="Working"
          eventsConnected
          inputDisabled={false}
          liveTools={[]}
          refresh={0}
          running
          onRunning={onRunning}
        />
      </Theme>,
    );
    const input = await screen.findByLabelText(/Ask Pi anything/i);
    expect(input).toBeEnabled();
    expect(input).toHaveAttribute(
      "placeholder",
      "Guide Pi while it is working…",
    );
    await user.type(input, "Change direction");
    await user.click(screen.getByRole("button", { name: "Steer" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/conversations/session/steer",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(onRunning).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeVisible();
  });

  test("queues follow-up input and restores native queued messages", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/conversations/session")
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url === "/api/conversations/session/follow-up")
        return new Response(JSON.stringify({ queued: true }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      if (
        url === "/api/conversations/session/queue" &&
        init?.method === "DELETE"
      )
        return new Response(
          JSON.stringify({
            queue: { sessionId: "session", steering: [], followUp: [] },
            restored: ["queued task"],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <ChatPage
          conversationId="session"
          delta="Working"
          eventsConnected
          inputDisabled={false}
          liveTools={[]}
          queue={{
            sessionId: "session",
            steering: ["change direction"],
            followUp: ["queued task"],
          }}
          refresh={0}
          running
          thinking=""
          onChooseModel={vi.fn()}
          onConversationChanged={vi.fn()}
          onRunning={vi.fn()}
          onStateChanged={vi.fn()}
        />
      </Theme>,
    );

    await user.click(
      screen.getByRole("combobox", { name: "Message delivery" }),
    );
    await user.click(screen.getByRole("option", { name: "Follow up" }));
    await user.type(
      screen.getByLabelText(/Ask Pi anything/i),
      "Run tests next",
    );
    await user.click(screen.getByRole("button", { name: "Follow up" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/conversations/session/follow-up",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Restore to editor" }));
    expect(screen.getByLabelText(/Ask Pi anything/i)).toHaveValue(
      "queued task",
    );
  });

  test("supports command and workspace autocomplete with keyboard input", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    let commandVersion = 0;
    let commandLoads = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/commands") {
        commandLoads += 1;
        return new Response(
          JSON.stringify([
            commandVersion === 0
              ? {
                  id: "command_review",
                  name: "review",
                  description: "Review changes",
                  argumentHint: "<PR>",
                  source: "prompt",
                  sourceLabel: "example.com/org/prompts",
                  provenance: { scope: "project", origin: "package" },
                }
              : {
                  id: "command_deploy",
                  name: "deploy",
                  description: "Deploy changes",
                  argumentHint: "<ENV>",
                  source: "prompt",
                  sourceLabel: "local",
                  provenance: { scope: "user", origin: "top-level" },
                },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "/api/conversations/session")
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url.startsWith("/api/workspace/files"))
        return new Response(
          JSON.stringify([{ path: "src/review file.ts", directory: false }]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    const chat = (resourceRefresh: number) => (
      <Theme>
        <ChatPage
          conversationId="session"
          delta=""
          eventsConnected
          inputDisabled={false}
          liveTools={[]}
          refresh={0}
          resourceRefresh={resourceRefresh}
          running={false}
          thinking=""
          onChooseModel={vi.fn()}
          onConversationChanged={vi.fn()}
          onRunning={vi.fn()}
          onStateChanged={vi.fn()}
        />
      </Theme>
    );
    const view = render(chat(0));
    const input = await screen.findByLabelText(/Ask Pi anything/i);
    await user.type(input, "/rev");
    const commandOption = await screen.findByRole("option", {
      name: /Review changes/,
    });
    expect(commandOption).toBeVisible();
    expect(commandOption).toHaveTextContent("<PR>");
    expect(commandOption).toHaveTextContent("example.com/org/prompts");
    expect(commandOption).toHaveTextContent("project package");
    await user.keyboard("{Enter}");
    expect(input).toHaveValue("/review ");

    commandVersion = 1;
    view.rerender(chat(1));
    await waitFor(() => expect(commandLoads).toBe(2));
    await user.clear(input);
    await user.type(input, "/dep");
    expect(
      await screen.findByRole("option", { name: /Deploy changes/ }),
    ).toHaveTextContent("<ENV>");

    await user.clear(input);
    await user.type(input, "open @rev");
    expect(
      await screen.findByRole("option", { name: /src\/review file\.ts/ }),
    ).toBeVisible();
    await user.keyboard("{Enter}");
    expect(input).toHaveValue('open @"src/review file.ts" ');

    await user.clear(input);
    await user.type(input, "中文");
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.compositionEnd(input);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url]) => String(url) === "/api/conversations/session/messages",
        ),
    ).toBe(false);
  });

  test("keeps duplicate native command names as distinct suggestions", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/commands")
        return new Response(
          JSON.stringify([
            {
              id: "command_extension_review",
              name: "review",
              description: "Extension review",
              source: "extension",
              sourceLabel: "review-tools",
              provenance: { scope: "user", origin: "top-level" },
            },
            {
              id: "command_prompt_review",
              name: "review",
              description: "Prompt review",
              source: "prompt",
              sourceLabel: "local",
              provenance: { scope: "user", origin: "top-level" },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      if (url === "/api/conversations/session")
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <ChatPage
          conversationId="session"
          delta=""
          eventsConnected
          inputDisabled={false}
          liveTools={[]}
          refresh={0}
          resourceRefresh={0}
          running={false}
          thinking=""
          onChooseModel={vi.fn()}
          onConversationChanged={vi.fn()}
          onRunning={vi.fn()}
          onStateChanged={vi.fn()}
        />
      </Theme>,
    );
    await user.type(await screen.findByLabelText(/Ask Pi anything/i), "/rev");

    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Extension review");
    expect(options[1]).toHaveTextContent("Prompt review");
  });

  test("renders thinking, merged tool diffs, extension state, and editor prefill", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/conversations/session")
        return new Response(
          JSON.stringify({
            messages: [
              {
                id: "assistant",
                role: "assistant",
                text: "Done",
                thinking: "Reasoning",
                timestamp: 1,
                tools: [
                  {
                    id: "tool",
                    name: "edit",
                    arguments: { path: "README.md" },
                    result: {
                      text: "Edited",
                      diff: "-old\n+new",
                      isError: false,
                    },
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    render(
      <Theme>
        <ChatPage
          conversationId="session"
          delta=""
          editorCommand={{ sequence: 1, text: "prefill", mode: "replace" }}
          eventsConnected
          extensionUi={{
            sessionId: "session",
            statuses: [{ key: "plan", text: "active" }],
            widgets: [
              { key: "todo", lines: ["One task"], placement: "aboveEditor" },
            ],
            editorText: "",
            workingVisible: true,
            hiddenThinkingLabel: "Reasoning details",
            toolsExpanded: true,
          }}
          inputDisabled={false}
          liveTools={[]}
          refresh={0}
          running={false}
          thinking=""
          onChooseModel={vi.fn()}
          onConversationChanged={vi.fn()}
          onRunning={vi.fn()}
          onStateChanged={vi.fn()}
        />
      </Theme>,
    );

    expect(await screen.findByText("Done")).toBeVisible();
    expect(screen.getByText("Reasoning details")).toBeVisible();
    expect(screen.getByText("+new")).toBeVisible();
    expect(screen.getByText("One task")).toBeVisible();
    expect(screen.getByText("active")).toBeVisible();
    expect(screen.getByLabelText(/Ask Pi anything/i)).toHaveValue("prefill");
  });

  test("restores active run and queue state after reconnect", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      onerror: (() => void) | null = null;
      onopen: (() => void) | null = null;
      private listeners = new Map<
        string,
        Array<(event: MessageEvent) => void>
      >();
      constructor() {
        FakeEventSource.instances.push(this);
      }
      addEventListener(
        type: string,
        listener: (event: MessageEvent) => void,
      ): void {
        this.listeners.set(type, [
          ...(this.listeners.get(type) ?? []),
          listener,
        ]);
      }
      emit(type: string, value: unknown): void {
        for (const listener of this.listeners.get(type) ?? [])
          listener({ data: JSON.stringify(value) } as MessageEvent);
      }
      close(): void {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    let stateRequests = 0;
    let transcriptRequests = 0;
    let commandRequests = 0;
    let recoveryListRequests = 0;
    let releaseHydration: (() => void) | undefined;
    let markHydrationStarted: (() => void) | undefined;
    const hydrationStarted = new Promise<void>((resolve) => {
      markHydrationStarted = resolve;
    });
    let releaseStaleList: (() => void) | undefined;
    let markStaleListStarted: (() => void) | undefined;
    const staleListStarted = new Promise<void>((resolve) => {
      markStaleListStarted = resolve;
    });
    const reconnectOperations: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url === "/api/session")
        return json({
          authenticated: true,
          authDisabled: false,
          tools: ["read"],
        });
      if (url === "/api/provider-auth") return json(null);
      if (url === "/api/commands") {
        commandRequests += 1;
        return json([]);
      }
      if (url === "/api/conversations?sort=recent") {
        recoveryListRequests++;
        if (recoveryListRequests === 4) {
          markStaleListStarted?.();
          return new Promise<Response>((resolve) => {
            releaseStaleList = () =>
              resolve(
                json([
                  {
                    id: "server-session",
                    createdAt: new Date(0).toISOString(),
                    modifiedAt: new Date(1).toISOString(),
                    messageCount: 0,
                    active: true,
                  },
                ]),
              );
          });
        }
        if (recoveryListRequests === 1)
          return new Response(
            JSON.stringify({ error: { code: "internal_error" } }),
            {
              status: 503,
              headers: { "content-type": "application/json" },
            },
          );
        return json([
          {
            id: "session",
            createdAt: new Date(0).toISOString(),
            modifiedAt: new Date(0).toISOString(),
            messageCount: 1,
            active: true,
          },
        ]);
      }
      if (url === "/api/conversations")
        return json([
          {
            id: "session",
            createdAt: new Date(0).toISOString(),
            modifiedAt: new Date(0).toISOString(),
            messageCount: 1,
            active: true,
          },
        ]);
      if (url === "/api/conversations/session") {
        transcriptRequests++;
        return json({
          messages:
            transcriptRequests > 1
              ? [
                  {
                    id: "recovered-message",
                    role: "assistant",
                    text: "Recovered transcript",
                    timestamp: 1,
                  },
                ]
              : [],
        });
      }
      if (url === "/api/conversations/session/state") {
        stateRequests++;
        reconnectOperations.push("state");
        const reconnected = stateRequests > 1;
        const response = {
          sessionId: "session",
          running: !reconnected,
          queue: {
            sessionId: "session",
            steering: reconnected ? [] : ["restored steering"],
            followUp: reconnected ? ["reconnected follow-up"] : [],
          },
          preferences: {
            steeringMode: "all",
            followUpMode: "all",
            autoCompaction: true,
            autoRetry: true,
            activeTools: ["read"],
            availableTools: [{ name: "read", description: "Read" }],
          },
          stats: {
            userMessages: 1,
            assistantMessages: 0,
            toolCalls: 0,
            toolResults: 0,
            totalMessages: 1,
            tokens: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
            cost: 0,
          },
          tree: [],
          leafId: null,
          treeTruncated: false,
          extensionUi: {
            sessionId: "session",
            statuses: [],
            widgets: [],
            editorText: reconnected
              ? "recovered editor update"
              : "restored draft",
            workingVisible: true,
            toolsExpanded: false,
          },
        };
        if (stateRequests === 2) {
          markHydrationStarted?.();
          return new Promise<Response>((resolve) => {
            releaseHydration = () => resolve(json(response));
          });
        }
        return json(response);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<App />);

    expect(await screen.findByText("restored steering")).toBeVisible();
    expect(screen.getByRole("button", { name: "Stop" })).toBeVisible();
    expect(screen.getByLabelText(/Ask Pi anything/i)).toHaveValue(
      "restored draft",
    );
    const source = FakeEventSource.instances.at(-1);
    if (!source) throw new Error("EventSource was not created");
    await waitFor(() => expect(commandRequests).toBe(1));
    source.emit("agent_status", {
      sessionId: "session",
      kind: "retry",
      status: "waiting",
      message: "stale activity",
    });
    expect(await screen.findByText("retry: stale activity")).toBeVisible();
    reconnectOperations.length = 0;
    source.onerror?.();
    source.onopen?.();
    await hydrationStarted;
    source.emit("message_complete", { sessionId: "session" });
    releaseHydration?.();

    expect(await screen.findByText("reconnected follow-up")).toBeVisible();
    expect(screen.queryByText("retry: stale activity")).toBeNull();
    expect(await screen.findByText("Recovered transcript")).toBeVisible();
    expect(screen.getByLabelText(/Ask Pi anything/i)).toHaveValue(
      "recovered editor update",
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stop" })).toBeNull(),
    );
    expect(stateRequests).toBeGreaterThanOrEqual(2);
    expect(transcriptRequests).toBeGreaterThanOrEqual(2);
    expect(recoveryListRequests).toBe(3);
    expect(reconnectOperations).toEqual(["state", "state"]);

    const commandsBeforeReset = commandRequests;
    source.emit("reset", {});
    await waitFor(() =>
      expect(commandRequests).toBeGreaterThan(commandsBeforeReset),
    );
    const stateBeforeStaleRecovery = stateRequests;
    source.onerror?.();
    source.onopen?.();
    await staleListStarted;
    cleanup();
    releaseStaleList?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stateRequests).toBe(stateBeforeStaleRecovery);
  });

  test("keeps a forked draft out of the conversation being replaced", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/conversations/session")
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (
        url === "/api/conversations/session/fork" &&
        init?.method === "POST"
      ) {
        expect(init.body).toBe(
          JSON.stringify({ targetId: "entry", position: "before" }),
        );
        return new Response(
          JSON.stringify({ id: "forked", selectedText: "Original prompt" }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const onConversationChanged = vi.fn(async () => undefined);
    const user = userEvent.setup();

    render(
      <Theme>
        <ChatPage
          agentState={{
            sessionId: "session",
            running: false,
            queue: { sessionId: "session", steering: [], followUp: [] },
            preferences: {
              steeringMode: "all",
              followUpMode: "all",
              autoCompaction: true,
              autoRetry: true,
              activeTools: ["read"],
              availableTools: [{ name: "read", description: "Read" }],
            },
            stats: {
              model: { provider: "test", id: "model", name: "Test model" },
              sessionBytes: 1_024,
              userMessages: 1,
              assistantMessages: 0,
              toolCalls: 0,
              toolResults: 0,
              totalMessages: 1,
              tokens: {
                input: 1,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 1,
              },
              cost: 0,
            },
            tree: [
              {
                id: "entry",
                parentId: null,
                type: "message",
                timestamp: new Date(0).toISOString(),
                preview: "Original prompt",
                canForkBefore: true,
                children: [],
              },
            ],
            leafId: "entry",
            treeTruncated: false,
            extensionUi: {
              sessionId: "session",
              statuses: [],
              widgets: [],
              editorText: "",
              workingVisible: true,
              toolsExpanded: false,
            },
          }}
          conversationId="session"
          delta=""
          eventsConnected
          inputDisabled={false}
          liveTools={[]}
          refresh={0}
          running={false}
          thinking=""
          onChooseModel={vi.fn()}
          onConversationChanged={onConversationChanged}
          onRunning={vi.fn()}
          onStateChanged={vi.fn()}
        />
      </Theme>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Conversation details" }),
    );
    expect(screen.getByText("Test model")).toBeVisible();
    expect(screen.getByText("1.0 KB")).toBeVisible();
    await user.click(screen.getByRole("treeitem"));
    await user.click(screen.getByRole("button", { name: "Fork" }));
    await waitFor(() =>
      expect(onConversationChanged).toHaveBeenCalledWith("forked"),
    );
    expect(screen.getByLabelText("Ask Pi anything…")).toHaveValue("");
  });

  test("preserves the active conversation when creating another fails", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      onerror: (() => void) | null = null;
      onopen: (() => void) | null = null;

      constructor() {
        FakeEventSource.instances.push(this);
      }

      addEventListener(): void {}
      close(): void {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    let finishCreate: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/session")
        return new Response(
          JSON.stringify({
            authenticated: true,
            authDisabled: false,
            tools: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      if (url === "/api/provider-auth")
        return new Response("null", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url === "/api/conversations" && init?.method === "POST")
        return new Promise<Response>((resolve) => {
          finishCreate = resolve;
        });
      if (url === "/api/conversations")
        return new Response(
          JSON.stringify([
            {
              id: "existing-conversation",
              createdAt: new Date(0).toISOString(),
              modifiedAt: new Date(0).toISOString(),
              messageCount: 0,
              active: true,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      if (url === "/api/conversations/existing-conversation")
        return new Response(
          JSON.stringify({
            messages: [
              {
                id: "existing-message",
                role: "user",
                text: "Existing message",
                timestamp: 0,
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(<App />);
    const create = await screen.findByRole("button", {
      name: /new conversation/i,
    });
    expect(await screen.findByText("Existing message")).toBeVisible();
    await user.click(create);
    expect(create).toBeDisabled();
    expect(screen.getByLabelText(/Ask Pi anything/i)).toBeDisabled();
    expect(screen.getByText("Existing message")).toBeVisible();
    finishCreate?.(
      new Response(JSON.stringify({ error: { code: "internal_error" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    expect(
      await screen.findByText(/previous conversation is still available/i),
    ).toBeVisible();
    expect(create).toBeEnabled();
    FakeEventSource.instances.at(-1)?.onopen?.();
    await waitFor(() =>
      expect(screen.getByLabelText(/Ask Pi anything/i)).toBeEnabled(),
    );
  });

  test("requires acknowledgement to trust and reload project resources", async () => {
    let trusted = false;
    let failNextRefresh = false;
    const mutations: boolean[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/models") {
        if (failNextRefresh) {
          failNextRefresh = false;
          return new Response(
            JSON.stringify({ error: { code: "internal_error" } }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            thinkingLevel: "off",
            thinkingLevels: ["off"],
            authPending: false,
            projectTrust: { required: false, trusted },
            models: [],
            providers: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "/api/project-trust" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as {
          trusted: boolean;
          acknowledgeRisk: boolean;
        };
        expect(body.acknowledgeRisk).toBe(true);
        trusted = body.trusted;
        if (trusted) failNextRefresh = true;
        mutations.push(trusted);
        return new Response(JSON.stringify({ required: false, trusted }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );

    expect(
      await screen.findByText(/no project resources that require trust/i),
    ).toBeVisible();
    const trustedCodeWarning = screen.getByRole("note");
    expect(trustedCodeWarning).toHaveTextContent(
      /packages, skills, extensions, and MCP servers.*container's permissions/i,
    );
    const enable = screen.getByRole("button", {
      name: /trust project resources/i,
    });
    expect(enable).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", {
        name: /extensions and packages can execute arbitrary code/i,
      }),
    );
    await user.click(enable);
    expect(
      await screen.findByText(/project resources are trusted and reloaded/i),
    ).toBeVisible();
    expect(trustedCodeWarning).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: /disable project resources/i }),
    );
    expect(
      await screen.findByText(/project resources are disabled and reloaded/i),
    ).toBeVisible();
    expect(mutations).toEqual([true, false]);
  });

  test("refreshes project trust when resources reload", async () => {
    let trusted = false;
    let loads = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) !== "/api/models")
        throw new Error(`Unexpected request: ${String(input)}`);
      loads += 1;
      return new Response(
        JSON.stringify({
          thinkingLevel: "off",
          thinkingLevels: ["off"],
          authPending: false,
          projectTrust: { required: true, trusted },
          models: [],
          providers: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const settings = (refresh: number) => (
      <Theme>
        <SettingsPage
          refresh={refresh}
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>
    );
    const view = render(settings(0));

    expect(
      await screen.findByText(/Not trusted\. Project skills/i),
    ).toBeVisible();
    trusted = true;
    view.rerender(settings(1));

    expect(
      await screen.findByText(/Trusted\. Project resources can load/i),
    ).toBeVisible();
    expect(loads).toBe(2);
  });

  test("adds an API key through a focused access flow", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/models") {
        return new Response(
          JSON.stringify({
            thinkingLevel: "off",
            thinkingLevels: ["off"],
            authPending: false,
            models: [],
            providers: [
              {
                id: "anthropic",
                name: "Anthropic",
                status: { configured: false, disconnectable: false },
                auth: {
                  apiKey: { name: "Anthropic API key" },
                  oauth: {
                    name: "Anthropic (Claude Pro/Max)",
                    subscription: true,
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (String(input) === "/api/providers/anthropic/login") {
        expect(init?.body).toBe(
          JSON.stringify({ type: "api_key", apiKey: "private-key" }),
        );
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );

    expect(
      await screen.findByText(/no model access configured/i),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: /add access/i }));
    await user.click(screen.getByRole("tab", { name: /api key/i }));
    await user.click(screen.getByRole("button", { name: /Anthropic/i }));
    const secret = screen.getByLabelText("Anthropic API key");
    expect(secret).toHaveAttribute("type", "password");
    await user.type(secret, "private-key");
    await user.click(screen.getByRole("button", { name: /save api key/i }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/providers/anthropic/login",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(screen.queryByDisplayValue("private-key")).not.toBeInTheDocument();
  });

  test("separates subscriptions from API keys and searches each list", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          thinkingLevel: "off",
          thinkingLevels: ["off"],
          authPending: false,
          models: [],
          providers: [
            {
              id: "anthropic",
              name: "Anthropic",
              status: { configured: false, disconnectable: false },
              auth: {
                apiKey: { name: "Anthropic API key" },
                oauth: {
                  name: "Anthropic (Claude Pro/Max)",
                  subscription: true,
                },
              },
            },
            {
              id: "openai",
              name: "OpenAI",
              status: { configured: false, disconnectable: false },
              auth: { apiKey: { name: "OpenAI API key" } },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const user = userEvent.setup();

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );
    await user.click(
      await screen.findByRole("button", { name: /add access/i }),
    );

    expect(screen.getByText("Anthropic (Claude Pro/Max)")).toBeVisible();
    expect(screen.queryByText("OpenAI API key")).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "missing");
    expect(screen.getByText(/no matching providers/i)).toBeVisible();
    await user.clear(screen.getByRole("searchbox"));
    await user.click(screen.getByRole("tab", { name: /api key/i }));
    expect(screen.getByText("OpenAI API key")).toBeVisible();
  });

  test("previews a model and applies it only after confirmation", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/model")
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      return new Response(
        JSON.stringify({
          thinkingLevel: "off",
          thinkingLevels: ["off"],
          authPending: false,
          models: [
            { provider: "anthropic", id: "old", name: "Old model" },
            { provider: "anthropic", id: "new", name: "New model" },
          ],
          providers: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );
    await user.click(
      await screen.findByRole("button", { name: /change model/i }),
    );
    const applyModel = screen.getByRole("button", {
      name: /use this model/i,
    });
    expect(applyModel).toBeDisabled();
    await user.click(screen.getByText("New model"));
    expect(applyModel).toBeEnabled();
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/model",
      expect.objectContaining({ method: "PUT" }),
    );
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/model",
      expect.objectContaining({ method: "PUT" }),
    );

    await user.click(screen.getByRole("button", { name: /change model/i }));
    await user.click(screen.getByText("New model"));
    await user.click(screen.getByRole("button", { name: /use this model/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/model",
        expect.objectContaining({
          body: JSON.stringify({ provider: "anthropic", modelId: "new" }),
          method: "PUT",
        }),
      ),
    );
  });

  test("shows a partial credential state when access exists but no model is available", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          thinkingLevel: "off",
          thinkingLevels: ["off"],
          authPending: false,
          models: [],
          providers: [
            {
              id: "anthropic",
              name: "Anthropic",
              status: {
                configured: true,
                source: "stored",
                credentialType: "api_key",
                disconnectable: true,
              },
              auth: { apiKey: { name: "Anthropic API key" } },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );

    expect(await screen.findByText(/api key stored by pi/i)).toBeVisible();
    expect(screen.getByText(/no models are available/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /change model/i }),
    ).toBeDisabled();
  });

  test("shows managed credential sources without a disconnect action", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          current: { provider: "openai", id: "gpt", name: "GPT" },
          thinkingLevel: "off",
          thinkingLevels: ["off"],
          authPending: false,
          models: [{ provider: "openai", id: "gpt", name: "GPT" }],
          providers: [
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
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );

    expect(await screen.findByText("OPENAI_API_KEY")).toBeVisible();
    expect(screen.getByText(/managed outside pi agent/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /disconnect/i }),
    ).not.toBeInTheDocument();
  });

  test("offers reconnect for stored subscription access", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/models")
        return new Response(
          JSON.stringify({
            thinkingLevel: "off",
            thinkingLevels: ["off"],
            authPending: false,
            models: [],
            providers: [
              {
                id: "openai-codex",
                name: "OpenAI Codex",
                status: {
                  configured: true,
                  source: "stored",
                  credentialType: "oauth",
                  disconnectable: true,
                },
                auth: {
                  oauth: {
                    name: "OpenAI (ChatGPT Plus/Pro)",
                    subscription: true,
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      if (String(input) === "/api/providers/openai-codex/login")
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /reconnect/i }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/providers/openai-codex/login",
      expect.objectContaining({
        body: JSON.stringify({ type: "oauth" }),
        method: "POST",
      }),
    );
  });

  test("confirms stored credential removal and preserves it on cancel", async () => {
    vi.mocked(fetch).mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input) === "/api/models"
              ? {
                  thinkingLevel: "off",
                  thinkingLevels: ["off"],
                  authPending: false,
                  models: [],
                  providers: [
                    {
                      id: "anthropic",
                      name: "Anthropic",
                      status: {
                        configured: true,
                        source: "stored",
                        credentialType: "api_key",
                        disconnectable: true,
                      },
                      auth: { apiKey: { name: "Anthropic API key" } },
                    },
                  ],
                }
              : { ok: true },
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const user = userEvent.setup();

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );
    await user.click(
      await screen.findByRole("button", { name: /disconnect/i }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(/Anthropic/);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/providers/anthropic/logout",
      expect.anything(),
    );
  });

  test("restores a pending authentication flow through application bootstrap", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    class FakeEventSource {
      onerror: (() => void) | null = null;
      onopen: (() => void) | null = null;

      addEventListener(): void {}
      close(): void {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/session")
        return new Response(
          JSON.stringify({
            authenticated: true,
            authDisabled: false,
            tools: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      if (String(input) === "/api/conversations")
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (String(input) === "/api/provider-auth")
        return new Response(
          JSON.stringify({
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "waiting",
            method: "device_code",
            userCode: "BOOTSTRAP-1",
            verificationUri: "https://auth.openai.com/codex/device",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    render(<App />);

    expect(await screen.findByRole("dialog")).toHaveTextContent("BOOTSTRAP-1");
  });

  test("restores a pending authentication flow after page reload", () => {
    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "waiting",
            method: "device_code",
            userCode: "RESTORED-1",
            verificationUri: "https://auth.openai.com/codex/device",
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    expect(screen.getByRole("dialog")).toHaveTextContent("RESTORED-1");
    expect(
      screen.getByRole("button", { name: /cancel sign-in/i }),
    ).toBeVisible();
  });

  test("closes the access dialog while OAuth continues so recovery stays reachable", async () => {
    let finish: ((value: boolean) => void) | undefined;
    const onOAuth = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const onOpenChange = vi.fn();

    render(
      <Theme>
        <ModelAccessDialog
          open
          pending={false}
          providers={[
            {
              id: "anthropic",
              name: "Anthropic",
              status: { configured: false, disconnectable: false },
              auth: {
                oauth: {
                  name: "Anthropic (Claude Pro/Max)",
                  subscription: true,
                },
              },
            },
          ]}
          onApiKey={async () => true}
          onCancelAuth={async () => undefined}
          onOAuth={onOAuth}
          onOpenChange={onOpenChange}
        />
      </Theme>,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Anthropic/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    finish?.(true);
  });

  test("disables access choices while authentication is pending and cancels safely", async () => {
    const onCancelAuth = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();

    render(
      <Theme>
        <ModelAccessDialog
          open
          pending
          providers={[
            {
              id: "anthropic",
              name: "Anthropic",
              status: { configured: false, disconnectable: false },
              auth: {
                oauth: {
                  name: "Anthropic (Claude Pro/Max)",
                  subscription: true,
                },
              },
            },
          ]}
          onApiKey={async () => true}
          onCancelAuth={onCancelAuth}
          onOAuth={async () => true}
          onOpenChange={onOpenChange}
        />
      </Theme>,
    );

    expect(screen.getByRole("button", { name: /Anthropic/i })).toBeDisabled();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(onCancelAuth).toHaveBeenCalledOnce());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("warns when disconnecting the current model provider", () => {
    render(
      <Theme>
        <DisconnectProviderDialog
          open
          pending={false}
          provider={{
            id: "anthropic",
            name: "Anthropic",
            status: {
              configured: true,
              source: "stored",
              disconnectable: true,
            },
            auth: {},
          }}
          currentProvider="anthropic"
          onConfirm={async () => true}
          onOpenChange={() => undefined}
        />
      </Theme>,
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      /current model provider/i,
    );
  });

  test("shows loading and actionable provider errors", async () => {
    let rejectRequest: ((reason: Error) => void) | undefined;
    vi.mocked(fetch).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );

    expect(screen.getByText(/loading model access/i)).toBeVisible();
    rejectRequest?.(new Error("network_failed"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "network_failed",
    );
    expect(screen.getByRole("button", { name: /try again/i })).toBeVisible();
  });

  test("recommends Codex device code and submits the selected login method", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const onInteractionClose = vi.fn();

    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "waiting",
            method: "choose_method",
          }}
          interaction={{
            id: "method",
            kind: "select",
            scope: "provider_auth",
            title: "Select OpenAI Codex login method:",
            options: [
              { id: "browser", label: "Browser login (default)" },
              {
                id: "device_code",
                label: "Device code login (headless)",
              },
            ],
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={onInteractionClose}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    const methods = screen.getAllByRole("radio");
    expect(methods[0]).toHaveAccessibleName(/^device code$/i);
    expect(methods[0]).toBeChecked();
    expect(screen.getByText(/recommended for Docker/i)).toBeVisible();
    const primaryAction = screen.getByRole("button", {
      name: /continue with device code/i,
    });
    expect(primaryAction).toBeVisible();
    await userEvent.setup().click(primaryAction);
    expect(fetch).toHaveBeenCalledWith(
      "/api/interactions/method",
      expect.objectContaining({
        body: JSON.stringify({ value: "device_code" }),
        method: "POST",
      }),
    );
    expect(onInteractionClose).toHaveBeenCalledOnce();
  });

  test("keeps non-Codex subscription device codes provider neutral", () => {
    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "radius",
            providerName: "Radius",
            phase: "waiting",
            method: "device_code",
            userCode: "RADIUS-1",
            verificationUri: "https://radius.example/device",
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    expect(
      screen.getByRole("link", { name: /open provider/i }),
    ).toHaveAttribute("href", "https://radius.example/device");
    expect(screen.queryByText(/ChatGPT/i)).not.toBeInTheDocument();
  });

  test("shows a Codex device code without requiring notification text", async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "waiting",
            method: "device_code",
            userCode: "ABCD-1234",
            verificationUri: "https://auth.openai.com/codex/device",
            expiresAt: Date.now() + 900_000,
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    expect(
      screen.getByRole("status", { name: /device code/i }),
    ).toHaveTextContent("ABCD-1234");
    expect(screen.getByRole("link", { name: /open OpenAI/i })).toHaveAttribute(
      "href",
      "https://auth.openai.com/codex/device",
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /copy code/i }));
    expect(writeText).toHaveBeenCalledWith("ABCD-1234");
    expect(screen.getByText(/waiting for OpenAI/i)).toBeVisible();
  });

  test("keeps browser login and manual redirect entry in one auth task", async () => {
    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "waiting",
            method: "browser",
            url: "https://auth.openai.com/oauth/authorize",
            message: "Complete login in your browser.",
          }}
          interaction={{
            id: "manual",
            kind: "text",
            scope: "provider_auth",
            title: "Paste the authorization code or redirect URL",
            placeholder: "http://localhost:1455/auth/callback",
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    expect(screen.getByRole("link", { name: /open OpenAI/i })).toHaveAttribute(
      "href",
      "https://auth.openai.com/oauth/authorize",
    );
    expect(
      screen.getByLabelText(/authorization code or redirect URL/i),
    ).toBeVisible();
    expect(screen.getByText(/callback may not reach Docker/i)).toBeVisible();
  });

  test("offers model selection only after subscription authentication succeeds", async () => {
    const onChooseModel = vi.fn();
    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "succeeded",
          }}
          onChooseModel={onChooseModel}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/connected/i);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /choose a model/i }));
    expect(onChooseModel).toHaveBeenCalledOnce();
  });

  test("moves an expired device code to a retry state", () => {
    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "waiting",
            method: "device_code",
            userCode: "EXPIRED-1",
            verificationUri: "https://auth.openai.com/codex/device",
            expiresAt: Date.now() - 1,
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/expired/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeVisible();
  });

  test("cancels an expired device login before retrying", async () => {
    let finishCancellation: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation((input) => {
      if (String(input) === "/api/providers/login/cancel")
        return new Promise<Response>((resolve) => {
          finishCancellation = resolve;
        });
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    const onDismiss = vi.fn();
    const onRetry = vi.fn();

    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "waiting",
            method: "device_code",
            userCode: "EXPIRED-1",
            verificationUri: "https://auth.openai.com/codex/device",
            expiresAt: Date.now() - 1,
          }}
          onChooseModel={() => undefined}
          onDismiss={onDismiss}
          onInteractionClose={() => undefined}
          onRetry={onRetry}
        />
      </Theme>,
    );

    const click = userEvent
      .setup()
      .click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/providers/login/cancel",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(onRetry).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /try again/i })).toBeDisabled();

    finishCancellation?.(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await click;
    await waitFor(() => expect(onRetry).toHaveBeenCalledWith("openai-codex"));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test("keeps cancelled authentication recoverable", () => {
    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "cancelled",
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/cancelled/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeVisible();
  });

  test("keeps failed authentication recoverable without exposing details", async () => {
    const onRetry = vi.fn();
    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "failed",
            error: "login_failed",
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={onRetry}
        />
      </Theme>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/could not connect/i);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledWith("openai-codex");
    expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();
  });

  test("keeps OAuth recovery links and device codes directly actionable", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    render(
      <Theme>
        <AuthNotification
          notification={{
            message: "Complete provider sign-in",
            url: "https://provider.example/authorize",
            code: "ABCD-1234",
          }}
          onClose={() => undefined}
        />
      </Theme>,
    );

    expect(
      screen.getByRole("link", { name: /open provider/i }),
    ).toHaveAttribute("href", "https://provider.example/authorize");
    expect(screen.getByText("ABCD-1234")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith("ABCD-1234");
    expect(screen.getByRole("button", { name: /copied/i })).toBeVisible();
  });

  test("keeps OAuth recovery inside an active interaction dialog", () => {
    render(
      <InteractionDialog
        interaction={{ id: "code", kind: "text", title: "Paste code" }}
        authNotification={{
          message: "Open the provider first",
          url: "https://provider.example/authorize",
        }}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole("dialog")).toContainElement(
      screen.getByRole("link", { name: /open provider/i }),
    );
  });

  test("keeps interaction dialogs keyboard operable", async () => {
    const onClose = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(
      <InteractionDialog
        interaction={{ id: "one", kind: "input", title: "Your answer" }}
        onClose={onClose}
      />,
    );

    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Your answer" }),
      "hello",
    );
    await user.click(screen.getByRole("button", { name: i18n.t("continue") }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(
      "/api/interactions/one",
      expect.objectContaining({
        body: JSON.stringify({ value: "hello" }),
        method: "POST",
      }),
    );
  });

  test("responds to the broker when a dialog is cancelled", async () => {
    const onClose = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(
      <InteractionDialog
        interaction={{ id: "cancelled", kind: "confirm", title: "Continue?" }}
        onClose={onClose}
      />,
    );

    await userEvent.setup().keyboard("{Escape}");

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(
      "/api/interactions/cancelled",
      expect.objectContaining({ body: "{}", method: "POST" }),
    );
  });
});
