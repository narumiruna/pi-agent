import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Button, Callout, Spinner, Theme } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
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
  Conversation,
  InteractionEvent,
  LiveTool,
  SessionInfo,
} from "./types.js";

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
  const [interaction, setInteraction] = useState<InteractionEvent>();
  const [providerAuth, setProviderAuth] = useState<ProviderAuthTask>();
  const [chooseModelRequest, setChooseModelRequest] = useState(0);
  const [notification, setNotification] = useState<AuthNotificationData>();
  const [dark, setDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  const loadConversations = useCallback(async () => {
    const result = await api<Conversation[]>("/api/conversations");
    setConversations(result);
    const active =
      result.find((conversation) => conversation.active) ?? result[0];
    setActiveId((current) =>
      current && result.some((conversation) => conversation.id === current)
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
    source.addEventListener("run_status", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as {
        status: string;
        kind?: string;
      };
      if (event.kind === "heartbeat") {
        setRefresh((value) => value + 1);
      } else if (event.status === "running") {
        setRunning(true);
      } else {
        setRunning(false);
        setDelta("");
        setLiveTools([]);
        setRefresh((value) => value + 1);
        void loadConversations();
      }
    });
    source.addEventListener("tool_status", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as LiveTool;
      setLiveTools((current) => {
        const existing = current.findIndex((tool) => tool.id === event.id);
        if (existing < 0) return [...current, event];
        return current.map((tool, index) =>
          index === existing ? { ...tool, ...event } : tool,
        );
      });
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
        statusText?: string;
      };
      const message = event.message ?? event.statusText;
      if (message) setNotification({ message });
    });
    source.addEventListener("provider_auth", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as
        | ProviderAuthTask
        | { phase: "dismissed" };
      setProviderAuth(event.phase === "dismissed" ? undefined : event);
    });
    source.addEventListener("reset", () => setRefresh((value) => value + 1));
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
  }, [activeId, loadConversations, session]);

  const createConversation = async () => {
    if (conversationPending) return;
    const previousId = activeId;
    setConversationPending(true);
    setActiveId(undefined);
    try {
      const result = await api<{ id: string }>(
        "/api/conversations",
        mutation("POST"),
      );
      await loadConversations();
      setActiveId(result.id);
      setPage("chat");
    } catch {
      setActiveId(previousId);
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
            newPending={conversationPending}
            onMobileOpen={setMobileOpen}
            onPage={setPage}
            onConversation={setActiveId}
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
                conversationId={activeId}
                refresh={refresh}
                delta={delta}
                running={running}
                liveTools={liveTools}
                eventsConnected={Boolean(
                  activeId && eventsConnectedFor === activeId,
                )}
                onRunning={setRunning}
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
