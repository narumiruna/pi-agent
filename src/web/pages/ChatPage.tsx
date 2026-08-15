import {
  Cross2Icon,
  ImageIcon,
  PaperPlaneIcon,
  StopIcon,
} from "@radix-ui/react-icons";
import {
  Button,
  Code,
  Flex,
  IconButton,
  ScrollArea,
  Select,
  Text,
  TextArea,
  Tooltip,
} from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CHAT_IMAGE_MIME_TYPES,
  type ChatImage,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGES,
  normalizeChatImageMimeType,
  resourceProvenanceLabel,
  type WebResourceCommand,
} from "../../shared/contracts.js";
import { api, mutation } from "../api.js";
import { ConversationPanel } from "../components/ConversationPanel.js";
import type {
  AgentActivity,
  AgentQueueState,
  ConversationAgentState,
  ExtensionUiSnapshot,
  LiveTool,
  TranscriptImage,
  TranscriptMessage,
  TranscriptTool,
} from "../types.js";

interface Props {
  conversationId?: string;
  refresh: number;
  delta: string;
  thinking: string;
  running: boolean;
  inputDisabled: boolean;
  liveTools: LiveTool[];
  queue?: AgentQueueState;
  activity?: AgentActivity;
  agentState?: ConversationAgentState;
  extensionUi?: ExtensionUiSnapshot;
  editorCommand?: {
    sequence: number;
    text: string;
    mode: "append" | "replace";
  };
  eventsConnected: boolean;
  onRunning: (running: boolean) => void;
  onConversationChanged: (id: string) => Promise<void>;
  onStateChanged: () => void;
  onChooseModel: () => void;
}

interface ComposerSuggestion {
  id: string;
  label: string;
  description?: string;
  kind: "command" | "file";
  value: string;
}

function localId(): string {
  return typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

function readImage(
  file: File,
  mimeType: ChatImage["mimeType"],
): Promise<TranscriptImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Image read failed"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Image read failed"));
        return;
      }
      const separator = reader.result.indexOf(",");
      if (separator < 0) {
        reject(new Error("Image read failed"));
        return;
      }
      resolve({
        id: localId(),
        type: "image",
        data: reader.result.slice(separator + 1),
        mimeType,
      });
    };
    reader.readAsDataURL(file);
  });
}

function imageSource(image: ChatImage): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

function fuzzyScore(value: string, query: string): number | undefined {
  const normalized = value.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  if (!normalizedQuery) return 0;
  if (normalized.startsWith(normalizedQuery)) return 1;
  const included = normalized.indexOf(normalizedQuery);
  if (included >= 0) return 2 + included / 1_000;
  let queryIndex = 0;
  let gap = 0;
  let previous = -1;
  for (const [index, character] of [...normalized].entries()) {
    if (character !== normalizedQuery[queryIndex]) continue;
    if (previous >= 0) gap += index - previous - 1;
    previous = index;
    queryIndex += 1;
    if (queryIndex === normalizedQuery.length) return 3 + gap / 1_000;
  }
  return undefined;
}

function keyedLines(lines: string[]): Array<{ id: string; line: string }> {
  const counts = new Map<string, number>();
  return lines.map((line) => {
    const count = (counts.get(line) ?? 0) + 1;
    counts.set(line, count);
    return { id: `${line}-${count}`, line };
  });
}

function DiffBlock({ diff }: { diff: string }) {
  return (
    <pre className="toolDiff">
      {keyedLines(diff.split("\n")).map(({ id, line }) => (
        <span
          className={
            line.startsWith("+")
              ? "added"
              : line.startsWith("-")
                ? "removed"
                : undefined
          }
          key={id}
        >
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function ToolBlock({
  tool,
  expanded,
}: {
  tool: TranscriptTool;
  expanded: boolean;
}) {
  return (
    <details
      className={tool.result?.isError ? "toolRow error" : "toolRow"}
      open={expanded || undefined}
    >
      <summary>
        {tool.name}
        {tool.result ? (tool.result.isError ? " · error" : " · done") : ""}
      </summary>
      <Code>{JSON.stringify(tool.arguments, null, 2)}</Code>
      {tool.result?.diff && <DiffBlock diff={tool.result.diff} />}
      {tool.result?.text && (
        <pre className="toolOutput">{tool.result.text}</pre>
      )}
      {tool.result?.images && (
        <div className="messageImages">
          {tool.result.images.map((image) => (
            <img alt="Tool result" key={image.id} src={imageSource(image)} />
          ))}
        </div>
      )}
    </details>
  );
}

export function ChatPage({
  conversationId,
  refresh,
  delta,
  thinking,
  running,
  inputDisabled,
  liveTools,
  queue,
  activity,
  agentState,
  extensionUi,
  editorCommand,
  eventsConnected,
  onRunning,
  onConversationChanged,
  onStateChanged,
  onChooseModel,
}: Props) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<TranscriptImage[]>([]);
  const [imageError, setImageError] = useState<string>();
  const [delivery, setDelivery] = useState<"follow-up" | "steer">("steer");
  const [commands, setCommands] = useState<WebResourceCommand[]>([]);
  const [fileSuggestions, setFileSuggestions] = useState<
    Array<{ path: string; directory: boolean }>
  >([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [dismissedSuggestionDraft, setDismissedSuggestionDraft] =
    useState<string>();
  const [historyIndex, setHistoryIndex] = useState(-1);
  const composing = useRef(false);
  const followingOutput = useRef(true);
  const loadedDraftFor = useRef<string>();
  const latestDraft = useRef("");
  const draftSyncEnabled = useRef(false);
  const draftSync = useRef<Promise<unknown>>(Promise.resolve());
  const end = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void api<WebResourceCommand[]>("/api/commands")
      .then(setCommands)
      .catch(() => setCommands([]));
  }, []);
  useEffect(() => {
    void refresh;
    if (!conversationId) {
      setMessages([]);
      return;
    }
    const abort = new AbortController();
    void api<{ messages: TranscriptMessage[] }>(
      `/api/conversations/${conversationId}`,
      { signal: abort.signal },
    )
      .then((data) => setMessages(data.messages))
      .catch(() => undefined);
    return () => abort.abort();
  }, [conversationId, refresh]);
  useEffect(() => {
    if (
      !conversationId ||
      extensionUi?.sessionId !== conversationId ||
      loadedDraftFor.current === conversationId
    )
      return;
    loadedDraftFor.current = conversationId;
    setDraft(extensionUi.editorText);
  }, [conversationId, extensionUi]);
  useEffect(() => {
    if (!editorCommand) return;
    setDraft((current) =>
      editorCommand.mode === "append"
        ? `${current}${editorCommand.text}`
        : editorCommand.text,
    );
  }, [editorCommand]);
  latestDraft.current = draft;
  draftSyncEnabled.current =
    Boolean(conversationId) && agentState?.sessionId === conversationId;
  const enqueueDraftSync = useCallback((id: string, text: string) => {
    draftSync.current = draftSync.current
      .catch(() => undefined)
      .then(() =>
        api(`/api/conversations/${id}/draft`, mutation("PUT", { text })),
      )
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!conversationId || agentState?.sessionId !== conversationId) return;
    const timer = window.setTimeout(
      () => enqueueDraftSync(conversationId, draft),
      150,
    );
    return () => window.clearTimeout(timer);
  }, [agentState?.sessionId, conversationId, draft, enqueueDraftSync]);
  useEffect(
    () => () => {
      if (conversationId && draftSyncEnabled.current)
        enqueueDraftSync(conversationId, latestDraft.current);
    },
    [conversationId, enqueueDraftSync],
  );

  const commandMatch = draft.match(/^\/([^\s]*)$/);
  const fileMatch = draft.match(/(?:^|\s)@([^\s@]*)$/);
  useEffect(() => {
    const query = fileMatch?.[1];
    if (!query) {
      setFileSuggestions([]);
      return;
    }
    setFileSuggestions([]);
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      void api<Array<{ path: string; directory: boolean }>>(
        `/api/workspace/files?q=${encodeURIComponent(query)}&limit=20`,
        { signal: abort.signal },
      )
        .then(setFileSuggestions)
        .catch(() => {
          if (!abort.signal.aborted) setFileSuggestions([]);
        });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [fileMatch?.[1]]);

  const suggestions = useMemo<ComposerSuggestion[]>(() => {
    if (draft === dismissedSuggestionDraft) return [];
    if (commandMatch) {
      const query = commandMatch[1];
      return commands
        .flatMap((command) => {
          const score = fuzzyScore(command.name, query);
          return score === undefined ? [] : [{ command, score }];
        })
        .sort(
          (left, right) =>
            left.score - right.score ||
            left.command.name.localeCompare(right.command.name),
        )
        .slice(0, 20)
        .map(({ command }) => ({
          id: `command:${command.name}`,
          kind: "command",
          label: `/${command.name}`,
          description: `${command.description || command.source} · ${resourceProvenanceLabel(command.provenance)}`,
          value: command.name,
        }));
    }
    if (fileMatch)
      return fileSuggestions.map((file) => ({
        id: `file:${file.path}`,
        kind: "file",
        label: `@${file.path}`,
        description: file.directory ? t("directory") : t("file"),
        value: file.path,
      }));
    return [];
  }, [
    commandMatch,
    commands,
    dismissedSuggestionDraft,
    draft,
    fileMatch,
    fileSuggestions,
    t,
  ]);

  useEffect(() => {
    void messages;
    void delta;
    if (!followingOutput.current) return;
    end.current?.scrollIntoView({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [messages, delta]);

  const promptHistory = useMemo(
    () =>
      messages
        .filter((message) => message.role === "user" && message.text)
        .map((message) => message.text),
    [messages],
  );

  const applySuggestion = (suggestion: ComposerSuggestion) => {
    if (suggestion.kind === "command") {
      setDraft(`/${suggestion.value} `);
      return;
    }
    const match = draft.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match || match.index === undefined) return;
    const at = draft.lastIndexOf("@", draft.length - match[1].length - 1);
    const value = suggestion.value.includes(" ")
      ? `@"${suggestion.value}"`
      : `@${suggestion.value}`;
    setDraft(`${draft.slice(0, at)}${value} `);
  };

  const addImages = async (files: File[]) => {
    setImageError(undefined);
    if (images.length + files.length > MAX_CHAT_IMAGES) {
      setImageError(t("imageLimit", { count: MAX_CHAT_IMAGES }));
      return;
    }
    const existingBytes = images.reduce(
      (total, image) => total + base64ByteLength(image.data),
      0,
    );
    const supportedFiles: Array<{
      file: File;
      mimeType: ChatImage["mimeType"];
    }> = [];
    for (const file of files) {
      const mimeType = normalizeChatImageMimeType(file.type);
      if (!mimeType) {
        setImageError(t("imageTypeUnsupported"));
        return;
      }
      supportedFiles.push({ file, mimeType });
    }
    if (
      supportedFiles.reduce(
        (total, { file }) => total + file.size,
        existingBytes,
      ) > MAX_CHAT_IMAGE_BYTES
    ) {
      setImageError(t("imagesTooLarge"));
      return;
    }
    try {
      const added = await Promise.all(
        supportedFiles.map(({ file, mimeType }) => readImage(file, mimeType)),
      );
      setImages((current) => [...current, ...added]);
    } catch {
      setImageError(t("imageReadFailed"));
    }
  };

  const send = async () => {
    if (
      !conversationId ||
      (!draft.trim() && images.length === 0) ||
      inputDisabled ||
      !eventsConnected
    )
      return;
    if (running && images.length > 0) {
      setImageError(t("queueImagesUnsupported"));
      return;
    }
    const message = draft.trim();
    followingOutput.current = true;
    const queued = running;
    const optimisticId = queued ? undefined : localId();
    const messageImages = images;
    const promptImages = images.map(({ type, data, mimeType }) => ({
      type,
      data,
      mimeType,
    }));
    setDraft("");
    setImages([]);
    setImageError(undefined);
    if (optimisticId)
      setMessages((current) => [
        ...current,
        {
          id: optimisticId,
          role: "user",
          text: message,
          timestamp: Date.now(),
          ...(messageImages.length > 0 ? { images: messageImages } : {}),
        },
      ]);
    if (!queued) onRunning(true);
    try {
      await api(
        `/api/conversations/${conversationId}/${queued ? delivery : "messages"}`,
        mutation("POST", {
          message,
          ...(promptImages.length > 0 ? { images: promptImages } : {}),
        }),
      );
      setHistoryIndex(-1);
    } catch {
      if (optimisticId)
        setMessages((current) =>
          current.filter((item) => item.id !== optimisticId),
        );
      setDraft((current) => current || message);
      setImages((current) => (current.length > 0 ? current : messageImages));
      if (!queued) onRunning(false);
    }
  };
  const stop = async () => {
    try {
      const result = await api<{
        queue?: { restored?: string[] };
      }>("/api/runs/abort", mutation("POST"));
      const restored = result.queue?.restored ?? [];
      if (restored.length > 0)
        setDraft((current) =>
          [current, ...restored].filter(Boolean).join("\n"),
        );
      onRunning(false);
    } catch {
      setImageError(t("stopFailed"));
    }
  };

  const clearQueue = async () => {
    if (!conversationId) return;
    try {
      const result = await api<{ restored: string[] }>(
        `/api/conversations/${conversationId}/queue`,
        mutation("DELETE"),
      );
      if (result.restored.length > 0)
        setDraft((current) =>
          [current, ...result.restored].filter(Boolean).join("\n"),
        );
    } catch {
      setImageError(t("queueRestoreFailed"));
    }
  };

  return (
    <section className="chatPage" aria-label={t("chat")}>
      <ScrollArea
        className="messageScroll"
        tabIndex={0}
        onScrollCapture={(event) => {
          const target = event.target as HTMLElement;
          followingOutput.current =
            target.scrollHeight - target.scrollTop - target.clientHeight < 80;
        }}
      >
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
                  {message.role === "assistant"
                    ? "Pi"
                    : message.label || message.role}
                </Text>
                {message.thinking && (
                  <details className="thinkingBlock">
                    <summary>
                      {extensionUi?.hiddenThinkingLabel || t("thinking")}
                    </summary>
                    <div className="markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.thinking}
                      </ReactMarkdown>
                    </div>
                  </details>
                )}
                <div className="messageContent">
                  {message.images && message.images.length > 0 && (
                    <div className="messageImages">
                      {message.images.map((image, index) => (
                        <img
                          alt={t("attachedImage", { number: index + 1 })}
                          key={image.id}
                          src={imageSource(image)}
                        />
                      ))}
                    </div>
                  )}
                  {message.text &&
                    (message.role === "tool" || message.role === "bash" ? (
                      <pre className="toolOutput">{message.text}</pre>
                    ) : (
                      <div className="markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.text}
                        </ReactMarkdown>
                      </div>
                    ))}
                </div>
                {message.tools?.map((tool) => (
                  <ToolBlock
                    expanded={extensionUi?.toolsExpanded === true}
                    key={tool.id}
                    tool={tool}
                  />
                ))}
              </article>
            ))
          )}
          {liveTools.map((tool) => (
            <details
              className={tool.status === "error" ? "toolRow error" : "toolRow"}
              key={tool.id}
              open={extensionUi?.toolsExpanded || undefined}
            >
              <summary>
                {tool.name} · {tool.status} · {tool.durationMs}ms
              </summary>
              {tool.diff && <DiffBlock diff={tool.diff} />}
              {tool.output ? (
                <pre className="toolOutput">{tool.output}</pre>
              ) : (
                <Code>{JSON.stringify(tool.result ?? tool.args, null, 2)}</Code>
              )}
            </details>
          ))}
          {thinking && (
            <details className="thinkingBlock live" open>
              <summary>
                {extensionUi?.hiddenThinkingLabel || t("thinking")}
              </summary>
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {thinking}
                </ReactMarkdown>
              </div>
            </details>
          )}
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
          {extensionUi?.widgets
            .filter((widget) => widget.placement === "aboveEditor")
            .map((widget) => (
              <div className="extensionWidget" key={widget.key}>
                {widget.lines.join("\n")}
              </div>
            ))}
          {extensionUi?.statuses.length ? (
            <div className="extensionStatuses" role="status">
              {extensionUi.statuses.map((status) => (
                <span key={status.key}>
                  <strong>{status.key}</strong> {status.text}
                </span>
              ))}
            </div>
          ) : null}
          {activity && !["done", "changed"].includes(activity.status) && (
            <Text
              as="p"
              color={activity.status === "error" ? "red" : "gray"}
              size="1"
            >
              {activity.kind}: {activity.message || activity.status}
            </Text>
          )}
          {running && extensionUi?.workingVisible !== false && (
            <Text as="p" color="gray" role="status" size="1">
              {extensionUi?.workingIndicator || "●"}{" "}
              {extensionUi?.workingMessage || t("working")}
            </Text>
          )}
          {queue && queue.steering.length + queue.followUp.length > 0 && (
            <section className="messageQueue" aria-label={t("messageQueue")}>
              <Flex align="center" justify="between">
                <Text size="1" weight="medium">
                  {t("messageQueue")}
                </Text>
                <Button
                  size="1"
                  variant="ghost"
                  onClick={() => void clearQueue()}
                >
                  {t("restoreQueue")}
                </Button>
              </Flex>
              {keyedLines(queue.steering).map(({ id, line }) => (
                <div key={`steer-${id}`}>
                  <strong>{t("steer")}</strong> {line}
                </div>
              ))}
              {keyedLines(queue.followUp).map(({ id, line }) => (
                <div key={`follow-up-${id}`}>
                  <strong>{t("followUp")}</strong> {line}
                </div>
              ))}
            </section>
          )}
          {images.length > 0 && (
            <ul aria-label={t("attachedImages")} className="attachmentTray">
              {images.map((image, index) => (
                <li className="attachmentPreview" key={image.id}>
                  <img
                    alt={t("attachedImage", { number: index + 1 })}
                    src={imageSource(image)}
                  />
                  <Tooltip content={t("removeImage")}>
                    <IconButton
                      aria-label={t("removeImage")}
                      className="removeAttachment"
                      color="gray"
                      size="1"
                      variant="solid"
                      onClick={() =>
                        setImages((current) =>
                          current.filter(
                            (_, imageIndex) => imageIndex !== index,
                          ),
                        )
                      }
                    >
                      <Cross2Icon />
                    </IconButton>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
          {imageError && (
            <Text as="p" color="red" role="alert" size="1">
              {imageError}
            </Text>
          )}
          <TextArea
            aria-label={t("messagePlaceholder")}
            placeholder={
              running ? t("steerPlaceholder") : t("messagePlaceholder")
            }
            value={draft}
            disabled={!conversationId || inputDisabled || !eventsConnected}
            onChange={(event) => {
              setDraft(event.target.value);
              setDismissedSuggestionDraft(undefined);
              setSuggestionIndex(0);
              setHistoryIndex(-1);
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onKeyDown={(event) => {
              if (composing.current || event.nativeEvent.isComposing) return;
              if (suggestions.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setSuggestionIndex((current) =>
                    event.key === "ArrowDown"
                      ? (current + 1) % suggestions.length
                      : (current - 1 + suggestions.length) % suggestions.length,
                  );
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  applySuggestion(
                    suggestions[suggestionIndex] ?? suggestions[0],
                  );
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDismissedSuggestionDraft(draft);
                  return;
                }
              }
              if (
                event.key === "ArrowUp" &&
                !draft &&
                promptHistory.length > 0
              ) {
                event.preventDefault();
                const next = Math.min(
                  historyIndex + 1,
                  promptHistory.length - 1,
                );
                setHistoryIndex(next);
                setDraft(promptHistory[promptHistory.length - 1 - next]);
                return;
              }
              if (event.key === "ArrowDown" && historyIndex >= 0) {
                event.preventDefault();
                const next = historyIndex - 1;
                setHistoryIndex(next);
                setDraft(
                  next < 0
                    ? ""
                    : promptHistory[promptHistory.length - 1 - next],
                );
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            onDrop={(event) => {
              const files = Array.from(event.dataTransfer.files);
              if (files.length < 1) return;
              event.preventDefault();
              void addImages(files);
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.items).flatMap(
                (item) => {
                  const file = item.kind === "file" ? item.getAsFile() : null;
                  return file ? [file] : [];
                },
              );
              if (files.length < 1) return;
              event.preventDefault();
              void addImages(files);
            }}
          />
          {suggestions.length > 0 && (
            <div className="composerSuggestions" role="listbox">
              {suggestions.map((suggestion, index) => (
                <button
                  aria-selected={index === suggestionIndex}
                  className={index === suggestionIndex ? "selected" : undefined}
                  key={suggestion.id}
                  role="option"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applySuggestion(suggestion)}
                >
                  <span>{suggestion.label}</span>
                  {suggestion.description && (
                    <small>{suggestion.description}</small>
                  )}
                </button>
              ))}
            </div>
          )}
          {extensionUi?.widgets
            .filter((widget) => widget.placement === "belowEditor")
            .map((widget) => (
              <div className="extensionWidget" key={widget.key}>
                {widget.lines.join("\n")}
              </div>
            ))}
          <input
            accept={CHAT_IMAGE_MIME_TYPES.join(",")}
            hidden
            multiple
            ref={imageInput}
            type="file"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (files.length > 0) void addImages(files);
            }}
          />
          <Flex align="center" justify="between" mt="2">
            <Flex align="center" gap="1">
              <Tooltip content={t("attachImage")}>
                <IconButton
                  aria-label={t("attachImage")}
                  disabled={
                    !conversationId || inputDisabled || !eventsConnected
                  }
                  variant="ghost"
                  onClick={() => imageInput.current?.click()}
                >
                  <ImageIcon />
                </IconButton>
              </Tooltip>
              {conversationId && (
                <ConversationPanel
                  conversationId={conversationId}
                  disabled={running || inputDisabled}
                  state={agentState}
                  onConversationChanged={onConversationChanged}
                  onDraft={(text, mode) =>
                    setDraft((current) =>
                      mode === "append" ? `${current}${text}` : text,
                    )
                  }
                  onStateChanged={onStateChanged}
                />
              )}
              <Button size="1" variant="ghost" onClick={onChooseModel}>
                {t("model")}
              </Button>
            </Flex>
            <Flex align="center" gap="2">
              {running && (
                <Select.Root
                  value={delivery}
                  onValueChange={(value) =>
                    setDelivery(value as "follow-up" | "steer")
                  }
                >
                  <Select.Trigger aria-label={t("deliveryMode")} />
                  <Select.Content>
                    <Select.Item value="steer">{t("steer")}</Select.Item>
                    <Select.Item value="follow-up">{t("followUp")}</Select.Item>
                  </Select.Content>
                </Select.Root>
              )}
              {running && (
                <Button color="red" variant="soft" onClick={() => void stop()}>
                  <StopIcon /> {t("stop")}
                </Button>
              )}
              <Tooltip
                content={
                  running
                    ? delivery === "steer"
                      ? t("steer")
                      : t("followUp")
                    : t("send")
                }
              >
                <IconButton
                  aria-label={
                    running
                      ? delivery === "steer"
                        ? t("steer")
                        : t("followUp")
                      : t("send")
                  }
                  disabled={
                    !conversationId ||
                    (!draft.trim() && images.length === 0) ||
                    inputDisabled ||
                    !eventsConnected
                  }
                  onClick={() => void send()}
                >
                  <PaperPlaneIcon />
                </IconButton>
              </Tooltip>
            </Flex>
          </Flex>
          {conversationId && agentState?.sessionId === conversationId && (
            <div className="sessionFooter" role="status">
              <span>
                {agentState.stats.tokens.total.toLocaleString()} {t("tokens")}
              </span>
              <span>
                {agentState.stats.contextUsage?.percent === null ||
                agentState.stats.contextUsage?.percent === undefined
                  ? t("contextUnknown")
                  : `${agentState.stats.contextUsage.percent.toFixed(1)}% ${t("context")}`}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
