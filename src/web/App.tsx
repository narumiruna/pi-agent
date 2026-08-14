import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Button, Callout, Spinner, Theme } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, mutation } from "./api.js";
import {
  AuthNotification,
  type AuthNotificationData,
} from "./components/AuthNotification.js";
import { InteractionDialog } from "./components/InteractionDialog.js";
import { Navigation, type Page } from "./components/Navigation.js";
import { ProviderAuthDialog } from "./components/ProviderAuthDialog.js";
import type { ProviderAuthTask } from "./model-access.js";
import { ChatPage } from "./pages/ChatPage.js";
import { HeartbeatPage } from "./pages/HeartbeatPage.js";
import { LibraryPage } from "./pages/LibraryPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import type {
  AgentActivity,
  AgentQueueState,
  Conversation,
  ConversationAgentState,
  ExtensionUiSnapshot,
  InteractionEvent,
  LiveTool,
  SessionInfo,
} from "./types.js";

export function updateLiveTools(
  current: LiveTool[],
  event: LiveTool,
  activeId: string | undefined,
): LiveTool[] {
  if (event.sessionId !== activeId) return current;
  const existing = current.findIndex((tool) => tool.id === event.id);
  if (existing < 0) return [...current, event];
  return current.map((tool, index) =>
    index === existing ? { ...tool, ...event } : tool,
  );
}

export function App() {
  const { t } = useTranslation();
  const [session, setSession] = useState<SessionInfo>();
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string>();
  const [page, setPage] = useState<Page>("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [conversationPending, setConversationPending] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [delta, setDelta] = useState("");
  const [running, setRunning] = useState(false);
  const [eventsConnectedFor, setEventsConnectedFor] = useState<string>();
  const [liveTools, setLiveTools] = useState<LiveTool[]>([]);
  const [thinking, setThinking] = useState("");
  const [queue, setQueue] = useState<AgentQueueState>();
  const [activity, setActivity] = useState<AgentActivity>();
  const [agentState, setAgentState] = useState<ConversationAgentState>();
  const [extensionUi, setExtensionUi] = useState<ExtensionUiSnapshot>();
  const [editorCommand, setEditorCommand] = useState<{
    sessionId: string;
    sequence: number;
    text: string;
    mode: "append" | "replace";
  }>();
  const [interaction, setInteraction] = useState<InteractionEvent>();
  const [providerAuth, setProviderAuth] = useState<ProviderAuthTask>();
  const [chooseModelRequest, setChooseModelRequest] = useState(0);
  const [notification, setNotification] = useState<AuthNotificationData>();
  const agentStateRequest = useRef(0);
  const [dark, setDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  const loadAgentState = useCallback(async (id: string) => {
    const request = ++agentStateRequest.current;
    const result = await api<ConversationAgentState>(
      `/api/conversations/${id}/state`,
    );
    if (request !== agentStateRequest.current) return result;
    setAgentState(result);
    setRunning(result.running);
    setQueue(result.queue);
    setExtensionUi(result.extensionUi);
    return result;
  }, []);

  const loadConversations = useCallback(async (preferredId?: string) => {
    const result = await api<Conversation[]>("/api/conversations");
    setConversations(result);
    const active =
      result.find((conversation) => conversation.active) ?? result[0];
    setActiveId((current) =>
      preferredId &&
      result.some((conversation) => conversation.id === preferredId)
        ? preferredId
        : current && result.some((conversation) => conversation.id === current)
          ? current
          : active?.id,
    );
  }, []);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const update = () => setDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    void api<SessionInfo>("/api/session")
      .then(async (result) => {
        const [authTask] = await Promise.all([
          api<ProviderAuthTask | null>("/api/provider-auth"),
          loadConversations(),
        ]);
        setProviderAuth(authTask ?? undefined);
        setSession(result);
      })
      .catch((reason) => {
        if (reason instanceof ApiError && reason.status === 401)
          setSignedOut(true);
        else setError(reason instanceof Error ? reason.message : "load_failed");
      });
  }, [loadConversations]);

  useEffect(() => {
    if (!session || !activeId) return;
    setDelta("");
    setThinking("");
    setLiveTools([]);
    setQueue(undefined);
    setActivity(undefined);
    setAgentState(undefined);
    setExtensionUi(undefined);
    setEditorCommand(undefined);
    void loadAgentState(activeId).catch(() => undefined);
  }, [activeId, loadAgentState, session]);

  useEffect(() => {
    document.title =
      activeId && extensionUi?.sessionId === activeId && extensionUi.title
        ? extensionUi.title
        : t("appName");
    return () => {
      document.title = t("appName");
    };
  }, [activeId, extensionUi, t]);

  useEffect(() => {
    if (!session) return;
    setEventsConnectedFor(undefined);
    const source = new EventSource("/api/events");
    source.onopen = () => setEventsConnectedFor(activeId);
    source.addEventListener("message_delta", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as {
        sessionId: string;
        delta: string;
      };
      if (event.sessionId === activeId)
        setDelta((current) => current + event.delta);
    });
    source.addEventListener("message_complete", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as {
        sessionId: string;
      };
      if (event.sessionId !== activeId) return;
      setDelta("");
      setThinking("");
      setLiveTools((current) =>
        current.filter((tool) => tool.status === "running"),
      );
      setRefresh((value) => value + 1);
    });
    source.addEventListener("run_status", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as {
        status: string;
        sessionId?: string;
        kind?: string;
      };
      if (event.kind === "heartbeat") {
        setRefresh((value) => value + 1);
      } else if (!event.sessionId || event.sessionId === activeId) {
        if (event.status === "running") setRunning(true);
        else {
          setRunning(false);
          setDelta("");
          setThinking("");
          setLiveTools([]);
          setRefresh((value) => value + 1);
          void loadConversations();
          if (activeId) void loadAgentState(activeId).catch(() => undefined);
        }
      }
    });
    source.addEventListener("tool_status", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as LiveTool;
      setLiveTools((current) => updateLiveTools(current, event, activeId));
    });
    source.addEventListener("thinking_status", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as {
        sessionId: string;
        status: string;
        delta?: string;
      };
      if (event.sessionId !== activeId) return;
      if (event.status === "running" && event.delta)
        setThinking((current) => current + event.delta);
    });
    source.addEventListener("queue_update", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as AgentQueueState;
      if (event.sessionId === activeId) setQueue(event);
    });
    source.addEventListener("agent_status", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as AgentActivity;
      if (event.sessionId === activeId) setActivity(event);
    });
    source.addEventListener("agent_config", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as {
        sessionId: string;
        preferences: ConversationAgentState["preferences"];
      };
      if (event.sessionId === activeId)
        setAgentState((current) =>
          current ? { ...current, preferences: event.preferences } : current,
        );
    });
    source.addEventListener("extension_ui", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as {
        snapshot: ExtensionUiSnapshot;
        editor?: { text: string; mode: "append" | "replace" };
      };
      if (event.snapshot.sessionId !== activeId) return;
      setExtensionUi(event.snapshot);
      if (event.editor)
        setEditorCommand((current) => ({
          sessionId: event.snapshot.sessionId,
          sequence: (current?.sequence ?? 0) + 1,
          ...event.editor,
        }));
    });
    source.addEventListener("package_progress", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as {
        message?: string;
        type?: string;
      };
      setNotification({
        message: event.message ?? event.type ?? "Package operation updated",
      });
    });
    source.addEventListener("interaction", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as {
        id: string;
        kind: string;
        scope?: "provider_auth";
      };
      if (event.kind === "dismiss") {
        setInteraction((current) =>
          current?.id === event.id ? undefined : current,
        );
      } else if (
        ["confirm", "editor", "input", "secret", "select", "text"].includes(
          event.kind,
        )
      ) {
        setInteraction(event as InteractionEvent);
      }
    });
    source.addEventListener("notification", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as {
        message?: string;
        type?: string;
      };
      if (event.message)
        setNotification({
          message: event.message,
          ...(event.type === "error" ||
          event.type === "info" ||
          event.type === "warning"
            ? { type: event.type }
            : {}),
        });
    });
    source.addEventListener("provider_auth", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as
        | ProviderAuthTask
        | { phase: "dismissed" };
      setProviderAuth(event.phase === "dismissed" ? undefined : event);
    });
    source.addEventListener("reset", () => {
      setRefresh((value) => value + 1);
      if (activeId) void loadAgentState(activeId).catch(() => undefined);
    });
    source.onerror = () => {
      setEventsConnectedFor(undefined);
      setNotification({ message: "Connection interrupted; retrying…" });
      void api<SessionInfo>("/api/session").catch((reason) => {
        if (reason instanceof ApiError && reason.status === 401) {
          source.close();
          setSignedOut(true);
        }
      });
    };
    return () => source.close();
  }, [activeId, loadAgentState, loadConversations, session]);

  const selectConversation = async (id: string) => {
    if (conversationPending || running || id === activeId) return;
    setConversationPending(true);
    try {
      await api(`/api/conversations/${id}/activate`, mutation("POST"));
      setActiveId(id);
      setPage("chat");
      await loadConversations(id).catch(() =>
        setNotification({
          message: t("conversationListRefreshFailed"),
          type: "warning",
        }),
      );
    } catch {
      setNotification({
        message: t("conversationSwitchFailed"),
        type: "error",
      });
    } finally {
      setConversationPending(false);
    }
  };

  const createConversation = async () => {
    if (conversationPending || running) return;
    setConversationPending(true);
    try {
      const result = await api<{ id: string }>(
        "/api/conversations",
        mutation("POST"),
      );
      setActiveId(result.id);
      setPage("chat");
      await loadConversations(result.id).catch(() =>
        setNotification({
          message: t("conversationListRefreshFailed"),
          type: "warning",
        }),
      );
    } catch {
      setNotification({ message: t("conversationCreateFailed") });
    } finally {
      setConversationPending(false);
    }
  };

  return (
    <Theme
      accentColor="teal"
      grayColor="slate"
      radius="small"
      appearance={dark ? "dark" : "light"}
    >
      {signedOut ? (
        <main className="loginPage">
          <div className="loginMark">π</div>
          <h1>{t("appName")}</h1>
          <p>{t("signedOut")}</p>
          <Button
            highContrast
            size="3"
            onClick={() => window.location.assign("/auth/login")}
          >
            {t("signIn")}
          </Button>
        </main>
      ) : error ? (
        <main className="centerState">
          <ExclamationTriangleIcon /> {t("error")}: {error}
        </main>
      ) : !session ? (
        <main className="centerState">
          <Spinner size="3" /> {t("loading")}
        </main>
      ) : (
        <div className="appShell">
          <Navigation
            page={page}
            conversations={conversations}
            activeId={activeId}
            mobileOpen={mobileOpen}
            newPending={conversationPending || running}
            onMobileOpen={setMobileOpen}
            onPage={setPage}
            onConversation={(id) => void selectConversation(id)}
            onNew={() => void createConversation()}
          />
          <main className="workspace">
            {session.authDisabled && (
              <Callout.Root className="authWarning" color="amber" role="alert">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>{t("authDisabled")}</Callout.Text>
              </Callout.Root>
            )}
            <AuthNotification
              notification={notification}
              onClose={() => setNotification(undefined)}
            />
            {page === "chat" && (
              <ChatPage
                key={activeId}
                conversationId={activeId}
                refresh={refresh}
                delta={delta}
                thinking={thinking}
                running={running}
                inputDisabled={conversationPending}
                liveTools={liveTools}
                queue={queue?.sessionId === activeId ? queue : undefined}
                activity={
                  activity?.sessionId === activeId ? activity : undefined
                }
                agentState={
                  agentState?.sessionId === activeId ? agentState : undefined
                }
                extensionUi={
                  extensionUi?.sessionId === activeId ? extensionUi : undefined
                }
                editorCommand={
                  editorCommand?.sessionId === activeId
                    ? editorCommand
                    : undefined
                }
                eventsConnected={Boolean(
                  activeId && eventsConnectedFor === activeId,
                )}
                onRunning={setRunning}
                onConversationChanged={async (id) => {
                  setActiveId(id);
                  setRefresh((value) => value + 1);
                  await loadConversations(id).catch(() =>
                    setNotification({
                      message: t("conversationListRefreshFailed"),
                      type: "warning",
                    }),
                  );
                }}
                onStateChanged={() => {
                  if (activeId)
                    void loadAgentState(activeId).catch(() => undefined);
                  setRefresh((value) => value + 1);
                }}
                onChooseModel={() => {
                  setPage("settings");
                  setChooseModelRequest((value) => value + 1);
                }}
              />
            )}
            {page === "heartbeat" && <HeartbeatPage refresh={refresh} />}
            {page === "library" && <LibraryPage />}
            {page === "settings" && (
              <SettingsPage
                chooseModelRequest={chooseModelRequest}
                session={session}
              />
            )}
          </main>
          <InteractionDialog
            interaction={
              interaction?.scope === "provider_auth" ? undefined : interaction
            }
            onClose={() => setInteraction(undefined)}
          />
          <ProviderAuthDialog
            interaction={
              interaction?.scope === "provider_auth" ? interaction : undefined
            }
            task={providerAuth}
            onChooseModel={() => {
              setPage("settings");
              setChooseModelRequest((value) => value + 1);
            }}
            onDismiss={() => {
              void api("/api/provider-auth", mutation("DELETE")).catch(
                () => undefined,
              );
              setProviderAuth(undefined);
            }}
            onInteractionClose={() => setInteraction(undefined)}
            onRetry={(providerId) => {
              setProviderAuth({
                providerId,
                providerName: providerAuth?.providerName ?? providerId,
                phase: "starting",
              });
              void api(
                `/api/providers/${providerId}/login`,
                mutation("POST", { type: "oauth" }),
              ).catch(() =>
                setProviderAuth({
                  providerId,
                  providerName: providerAuth?.providerName ?? providerId,
                  phase: "failed",
                  error: "login_failed",
                }),
              );
            }}
          />
        </div>
      )}
    </Theme>
  );
}
