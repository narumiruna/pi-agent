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
  Text,
  TextArea,
  Tooltip,
} from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CHAT_IMAGE_MIME_TYPES,
  type ChatImage,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGES,
  normalizeChatImageMimeType,
} from "../../shared/contracts.js";
import { api, mutation } from "../api.js";
import type { LiveTool, TranscriptImage, TranscriptMessage } from "../types.js";

interface Props {
  conversationId?: string;
  refresh: number;
  delta: string;
  running: boolean;
  inputDisabled: boolean;
  liveTools: LiveTool[];
  eventsConnected: boolean;
  onRunning: (running: boolean) => void;
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

export function ChatPage({
  conversationId,
  refresh,
  delta,
  running,
  inputDisabled,
  liveTools,
  eventsConnected,
  onRunning,
}: Props) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<TranscriptImage[]>([]);
  const [imageError, setImageError] = useState<string>();
  const end = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void refresh;
    if (!conversationId) return setMessages([]);
    void api<{ messages: TranscriptMessage[] }>(
      `/api/conversations/${conversationId}`,
    ).then((data) => setMessages(data.messages));
  }, [conversationId, refresh]);
  useEffect(() => {
    void conversationId;
    setImages([]);
    setImageError(undefined);
  }, [conversationId]);
  useEffect(() => {
    void messages;
    void delta;
    end.current?.scrollIntoView({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [messages, delta]);

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
      running ||
      inputDisabled ||
      !eventsConnected
    )
      return;
    const message = draft.trim();
    const messageImages = images;
    const promptImages = images.map(({ type, data, mimeType }) => ({
      type,
      data,
      mimeType,
    }));
    setDraft("");
    setImages([]);
    setImageError(undefined);
    setMessages((current) => [
      ...current,
      {
        id: localId(),
        role: "user",
        text: message,
        timestamp: Date.now(),
        ...(messageImages.length > 0 ? { images: messageImages } : {}),
      },
    ]);
    onRunning(true);
    try {
      await api(
        `/api/conversations/${conversationId}/messages`,
        mutation("POST", {
          message,
          ...(promptImages.length > 0 ? { images: promptImages } : {}),
        }),
      );
    } catch {
      setDraft((current) => current || message);
      setImages((current) => (current.length > 0 ? current : messageImages));
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
                    {message.text && (
                      <div className="markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.text}
                        </ReactMarkdown>
                      </div>
                    )}
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
            placeholder={t("messagePlaceholder")}
            value={draft}
            disabled={
              !conversationId || running || inputDisabled || !eventsConnected
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
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
            <Tooltip content={t("attachImage")}>
              <IconButton
                aria-label={t("attachImage")}
                disabled={
                  !conversationId ||
                  running ||
                  inputDisabled ||
                  !eventsConnected
                }
                variant="ghost"
                onClick={() => imageInput.current?.click()}
              >
                <ImageIcon />
              </IconButton>
            </Tooltip>
            {running ? (
              <Button color="red" variant="soft" onClick={() => void stop()}>
                <StopIcon /> {t("stop")}
              </Button>
            ) : (
              <Tooltip content={t("send")}>
                <IconButton
                  aria-label={t("send")}
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
            )}
          </Flex>
        </div>
      </div>
    </section>
  );
}
