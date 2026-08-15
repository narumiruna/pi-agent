import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Button, Callout, Spinner, Theme } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WebPackageProgress } from "../shared/contracts.js";
import { ApiError, api, mutation } from "./api.js";
import {
  AuthNotification,
  type AuthNotificationData,
} from "./components/AuthNotification.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { InteractionDialog } from "./components/InteractionDialog.js";
import { Navigation } from "./components/Navigation.js";
import { ProviderAuthDialog } from "./components/ProviderAuthDialog.js";
import type { ProviderAuthTask } from "./model-access.js";
import { ChatPage } from "./pages/ChatPage.js";
import { FilesPage } from "./pages/FilesPage.js";
import { HeartbeatPage } from "./pages/HeartbeatPage.js";
import { LibraryPage } from "./pages/LibraryPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { type Page, pageFromPathname, pathnameForPage } from "./routes.js";
import type {
  AgentActivity,
  AgentQueueState,
  Conversation,
  ConversationAgentState,
  ConversationFilters,
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

const ROUTE_HISTORY_INDEX = "piAgentRouteIndex";

function routeHistoryIndex(state: unknown): number | undefined {
  if (!state || typeof state !== "object") return undefined;
  const value = (state as Record<string, unknown>)[ROUTE_HISTORY_INDEX];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function routeHistoryState(state: unknown, index: number) {
  return {
    ...(state && typeof state === "object"
      ? (state as Record<string, unknown>)
      : {}),
    [ROUTE_HISTORY_INDEX]: index,
  };
}

export const DEFAULT_CONVERSATION_FILTERS: ConversationFilters = {
  search: "",
  name: "all",
  sort: "threaded",
};

export function conversationListPath(filters: ConversationFilters): string {
  const query = new URLSearchParams();
  const search = filters.search.trim();
  if (search) query.set("q", search.slice(0, 500));
  if (filters.name !== "all") query.set("name", filters.name);
  if (filters.sort !== "threaded") query.set("sort", filters.sort);
  const serialized = query.toString();
  return serialized ? `/api/conversations?${serialized}` : "/api/conversations";
}

export function App() {
  const { t } = useTranslation();
  const [session, setSession] = useState<SessionInfo>();
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string>();
  const [page, setPage] = useState<Page>(() =>
    pageFromPathname(window.location.pathname),
  );
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationFilters, setConversationFilters] =
    useState<ConversationFilters>(DEFAULT_CONVERSATION_FILTERS);
  const conversationFiltersRef = useRef(conversationFilters);
  const conversationListRequest = useRef(0);
  const conversationFilterReady = useRef(false);
  const [activeId, setActiveId] = useState<string>();
  const [conversationPending, setConversationPending] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [filesDirty, setFilesDirty] = useState(false);
  const [filesDiscardOpen, setFilesDiscardOpen] = useState(false);
  const pendingFilesAction = useRef<(() => void) | undefined>(undefined);
  const currentHistoryIndex = useRef(0);
  const restoringHistory = useRef(false);
  const acceptingHistory = useRef(false);
  const pendingHistoryNavigation = useRef<{ delta: number } | undefined>(
    undefined,
  );
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

  const navigate = useCallback((nextPage: Page) => {
    const pathname = pathnameForPage(nextPage);
    setPage(nextPage);
    if (window.location.pathname === pathname) return;
    const nextIndex = currentHistoryIndex.current + 1;
    currentHistoryIndex.current = nextIndex;
    window.history.pushState(
      routeHistoryState(window.history.state, nextIndex),
      "",
      pathname,
    );
  }, []);

  useEffect(() => {
    const initialPage = pageFromPathname(window.location.pathname);
    const canonicalPath = pathnameForPage(initialPage);
    const initialIndex = routeHistoryIndex(window.history.state) ?? 0;
    currentHistoryIndex.current = initialIndex;
    const url =
      window.location.pathname === canonicalPath
        ? `${window.location.pathname}${window.location.search}${window.location.hash}`
        : canonicalPath;
    window.history.replaceState(
      routeHistoryState(window.history.state, initialIndex),
      "",
      url,
    );
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const nextPage = pageFromPathname(window.location.pathname);
      const canonicalPath = pathnameForPage(nextPage);
      const nextIndex = routeHistoryIndex(event.state);

      if (acceptingHistory.current) {
        acceptingHistory.current = false;
        pendingHistoryNavigation.current = undefined;
        if (nextIndex !== undefined) currentHistoryIndex.current = nextIndex;
      } else if (restoringHistory.current) {
        restoringHistory.current = false;
        if (nextIndex !== undefined) currentHistoryIndex.current = nextIndex;
        const pending = pendingHistoryNavigation.current;
        if (pending) {
          pendingFilesAction.current = () => {
            acceptingHistory.current = true;
            window.history.go(pending.delta);
          };
          setFilesDiscardOpen(true);
        }
        return;
      } else {
        const delta =
          nextIndex === undefined
            ? undefined
            : nextIndex - currentHistoryIndex.current;
        if (
          page === "files" &&
          filesDirty &&
          nextPage !== page &&
          delta !== undefined &&
          delta !== 0
        ) {
          pendingHistoryNavigation.current = { delta };
          restoringHistory.current = true;
          window.history.go(-delta);
          return;
        }
        if (nextIndex !== undefined) currentHistoryIndex.current = nextIndex;
      }

      if (window.location.pathname !== canonicalPath)
        window.history.replaceState(
          routeHistoryState(window.history.state, currentHistoryIndex.current),
          "",
          canonicalPath,
        );
      setPage(nextPage);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [filesDirty, page]);

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

  const loadConversations = useCallback(
    async (preferredId?: string, filters = conversationFiltersRef.current) => {
      const request = ++conversationListRequest.current;
      let result: Conversation[];
      try {
        result = await api<Conversation[]>(conversationListPath(filters));
      } catch (error) {
        if (request !== conversationListRequest.current) return;
        throw error;
      }
      if (request !== conversationListRequest.current) return;
      setConversations(result);
      const active = result.find((conversation) => conversation.active);
      setActiveId((current) => preferredId ?? active?.id ?? current);
    },
    [],
  );

  const changeConversationFilters = (next: ConversationFilters) => {
    conversationFiltersRef.current = next;
    setConversationFilters(next);
  };

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
    if (!session) return;
    if (!conversationFilterReady.current) {
      conversationFilterReady.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      void loadConversations(undefined, conversationFilters).catch(() =>
        setNotification({
          message: t("conversationListRefreshFailed"),
          type: "warning",
        }),
      );
    }, 200);
    return () => window.clearTimeout(timer);
  }, [conversationFilters, loadConversations, session, t]);

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
    let reconnecting = false;
    let closed = false;
    let recoveryGeneration = 0;
    let recoveryTimer: number | undefined;
    const source = new EventSource("/api/events");
    const recover = async (generation: number): Promise<void> => {
      try {
        const native = await api<Conversation[]>(
          "/api/conversations?sort=recent",
        );
        if (closed || generation !== recoveryGeneration) return;
        const recoveredId =
          native.find((conversation) => conversation.active)?.id ?? activeId;
        if (!recoveredId) return;
        setActiveId(recoveredId);
        setRefresh((value) => value + 1);
        await Promise.all([
          loadAgentState(recoveredId),
          loadConversations(recoveredId),
        ]);
        if (closed || generation !== recoveryGeneration) return;
        setEventsConnectedFor(recoveredId);
      } catch (error) {
        if (closed || generation !== recoveryGeneration) return;
        if (error instanceof ApiError && error.status === 401) {
          source.close();
          setSignedOut(true);
          return;
        }
        recoveryTimer = window.setTimeout(() => void recover(generation), 500);
      }
    };
    source.onopen = () => {
      if (!reconnecting || !activeId) {
        setEventsConnectedFor(activeId);
        return;
      }
      reconnecting = false;
      setDelta("");
      setThinking("");
      setLiveTools([]);
      const generation = ++recoveryGeneration;
      void recover(generation);
    };
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
      const event = JSON.parse(
        (raw as MessageEvent).data,
      ) as WebPackageProgress;
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
      reconnecting = true;
      recoveryGeneration++;
      if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer);
      setEventsConnectedFor(undefined);
      setNotification({ message: "Connection interrupted; retrying…" });
      void api<SessionInfo>("/api/session").catch((reason) => {
        if (reason instanceof ApiError && reason.status === 401) {
          source.close();
          setSignedOut(true);
        }
      });
    };
    return () => {
      closed = true;
      recoveryGeneration++;
      if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer);
      source.close();
    };
  }, [activeId, loadAgentState, loadConversations, session]);

  const selectConversation = async (id: string) => {
    if (conversationPending || running) return;
    if (id === activeId) {
      navigate("chats");
      return;
    }
    setConversationPending(true);
    try {
      await api(`/api/conversations/${id}/activate`, mutation("POST"));
      setActiveId(id);
      navigate("chats");
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
      navigate("chats");
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

  const renameConversation = async (id: string, name: string) => {
    if (conversationPending || running) throw new Error("conversation_busy");
    setConversationPending(true);
    try {
      await api(`/api/conversations/${id}`, mutation("PATCH", { name }));
      await loadConversations(activeId)
        .then(() =>
          setNotification({
            message: t("conversationRenamed"),
            type: "info",
          }),
        )
        .catch(() =>
          setNotification({
            message: t("conversationListRefreshFailed"),
            type: "warning",
          }),
        );
    } catch (error) {
      setNotification({
        message: t("conversationManagementFailed"),
        type: "error",
      });
      throw error;
    } finally {
      setConversationPending(false);
    }
  };

  const deleteConversation = async (id: string) => {
    if (conversationPending || running) throw new Error("conversation_busy");
    setConversationPending(true);
    try {
      await api(`/api/conversations/${id}`, mutation("DELETE"));
      await loadConversations(activeId)
        .then(() =>
          setNotification({
            message: t("conversationDeleted"),
            type: "info",
          }),
        )
        .catch(() =>
          setNotification({
            message: t("conversationListRefreshFailed"),
            type: "warning",
          }),
        );
    } catch (error) {
      setNotification({
        message: t("conversationManagementFailed"),
        type: "error",
      });
      throw error;
    } finally {
      setConversationPending(false);
    }
  };

  const afterFilesDiscard = (action: () => void) => {
    if (page !== "files" || !filesDirty) {
      action();
      return;
    }
    pendingFilesAction.current = action;
    setFilesDiscardOpen(true);
  };

  const confirmFilesDiscard = () => {
    setFilesDiscardOpen(false);
    setFilesDirty(false);
    const action = pendingFilesAction.current;
    pendingFilesAction.current = undefined;
    action?.();
  };

  const chooseModel = () => {
    afterFilesDiscard(() => {
      navigate("settings");
      setChooseModelRequest((value) => value + 1);
    });
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
            onClick={() =>
              window.location.assign(
                `/auth/login?returnTo=${encodeURIComponent(pathnameForPage(page))}`,
              )
            }
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
            authenticated={session.authenticated}
            conversations={conversations}
            conversationFilters={conversationFilters}
            activeId={activeId}
            mobileOpen={mobileOpen}
            newPending={conversationPending || running}
            onMobileOpen={setMobileOpen}
            onConversationFilters={changeConversationFilters}
            onDeleteConversation={deleteConversation}
            onPage={(nextPage) => afterFilesDiscard(() => navigate(nextPage))}
            onRenameConversation={renameConversation}
            onConversation={(id) =>
              afterFilesDiscard(() => {
                navigate("chats");
                void selectConversation(id);
              })
            }
            onNew={() =>
              afterFilesDiscard(() => {
                navigate("chats");
                void createConversation();
              })
            }
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
            {page === "chats" && (
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
                onChooseModel={chooseModel}
              />
            )}
            {page === "files" && (
              <FilesPage
                appearance={dark ? "dark" : "light"}
                onDirtyChange={setFilesDirty}
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
          <ConfirmDialog
            open={filesDiscardOpen}
            title={t("filesDiscardTitle")}
            description={t("filesDiscardDescription")}
            confirmLabel={t("filesDiscard")}
            onOpenChange={(open) => {
              setFilesDiscardOpen(open);
              if (!open) {
                pendingFilesAction.current = undefined;
                pendingHistoryNavigation.current = undefined;
              }
            }}
            onConfirm={confirmFilesDiscard}
          />
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
            onChooseModel={chooseModel}
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
