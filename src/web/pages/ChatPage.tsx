import { PaperPlaneIcon, StopIcon } from "@radix-ui/react-icons";
import {
  Button,
  Code,
  Flex,
  IconButton,
  ScrollArea,
  Text,
  TextArea,
  Tooltip,
} from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, mutation } from "../api.js";
import type { LiveTool, TranscriptMessage } from "../types.js";

interface Props {
  conversationId?: string;
  refresh: number;
  delta: string;
  running: boolean;
  liveTools: LiveTool[];
  eventsConnected: boolean;
  onRunning: (running: boolean) => void;
}

export function ChatPage({
  conversationId,
  refresh,
  delta,
  running,
  liveTools,
  eventsConnected,
  onRunning,
}: Props) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void refresh;
    if (!conversationId) return setMessages([]);
    void api<{ messages: TranscriptMessage[] }>(
      `/api/conversations/${conversationId}`,
    ).then((data) => setMessages(data.messages));
  }, [conversationId, refresh]);
  useEffect(() => {
    void messages;
    void delta;
    end.current?.scrollIntoView({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [messages, delta]);

  const send = async () => {
    if (!conversationId || !draft.trim() || running || !eventsConnected) return;
    const message = draft.trim();
    setDraft("");
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: message,
        timestamp: Date.now(),
      },
    ]);
    onRunning(true);
    try {
      await api(
        `/api/conversations/${conversationId}/messages`,
        mutation("POST", { message }),
      );
    } catch {
      onRunning(false);
    }
  };
  const stop = async () => {
    await api("/api/runs/abort", mutation("POST"));
    onRunning(false);
  };

  return (
    <section className="chatPage" aria-label={t("chat")}>
      <ScrollArea className="messageScroll" tabIndex={0}>
        <div className="messageColumn">
          {messages.length === 0 && !delta ? (
            <div className="emptyState">
              <span className="emptyGlyph">π</span>
              <Text size="5" weight="medium">
                {conversationId ? t("emptyConversation") : t("newConversation")}
              </Text>
            </div>
          ) : (
            messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <Text className="messageRole" size="1" color="gray">
                  {message.role === "assistant" ? "Pi" : message.role}
                </Text>
                {message.role === "tool" ? (
                  <details
                    className={message.isError ? "toolRow error" : "toolRow"}
                  >
                    <summary>{message.toolName}</summary>
                    <Code>{message.text}</Code>
                  </details>
                ) : (
                  <div className="markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.text}
                    </ReactMarkdown>
                  </div>
                )}
                {message.tools?.map((tool) => (
                  <details className="toolRow" key={tool.id}>
                    <summary>{tool.name}</summary>
                    <Code>{JSON.stringify(tool.arguments, null, 2)}</Code>
                  </details>
                ))}
              </article>
            ))
          )}
          {liveTools.map((tool) => (
            <details
              className={tool.status === "error" ? "toolRow error" : "toolRow"}
              key={tool.id}
            >
              <summary>
                {tool.name} · {tool.status}
              </summary>
              <Code>{JSON.stringify(tool.result ?? tool.args, null, 2)}</Code>
            </details>
          ))}
          {delta && (
            <article className="message assistant streaming">
              <Text className="messageRole" size="1" color="gray">
                Pi
              </Text>
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {delta}
                </ReactMarkdown>
              </div>
            </article>
          )}
          <div ref={end} />
        </div>
      </ScrollArea>
      <div className="composerWrap">
        <div className="composer">
          <TextArea
            aria-label={t("messagePlaceholder")}
            placeholder={t("messagePlaceholder")}
            value={draft}
            disabled={!conversationId || running || !eventsConnected}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <Flex justify="end" mt="2">
            {running ? (
              <Button color="red" variant="soft" onClick={() => void stop()}>
                <StopIcon /> {t("stop")}
              </Button>
            ) : (
              <Tooltip content={t("send")}>
                <IconButton
                  aria-label={t("send")}
                  disabled={
                    !conversationId || !draft.trim() || !eventsConnected
                  }
                  onClick={() => void send()}
                >
                  <PaperPlaneIcon />
                </IconButton>
              </Tooltip>
            )}
          </Flex>
        </div>
      </div>
    </section>
  );
}
