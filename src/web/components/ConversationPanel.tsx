import * as Dialog from "@radix-ui/react-dialog";
import {
  CommitIcon,
  CopyIcon,
  DotsHorizontalIcon,
  DownloadIcon,
  UploadIcon,
} from "@radix-ui/react-icons";
import {
  Button,
  Callout,
  Flex,
  Heading,
  IconButton,
  ScrollArea,
  Text,
  TextArea,
  Tooltip,
} from "@radix-ui/themes";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, mutation } from "../api.js";
import type { ConversationAgentState, SessionTreeItem } from "../types.js";
import { DialogPortal } from "./DialogPortal.js";

interface FlatTreeItem extends SessionTreeItem {
  depth: number;
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function flattenTree(tree: SessionTreeItem[], depth = 0): FlatTreeItem[] {
  return tree.flatMap((item) => [
    { ...item, depth },
    ...flattenTree(item.children, depth + 1),
  ]);
}

interface Props {
  conversationId: string;
  disabled: boolean;
  state?: ConversationAgentState;
  onConversationChanged: (id: string) => Promise<void>;
  onDraft: (text: string, mode: "append" | "replace") => void;
  onStateChanged: () => void;
}

export function ConversationPanel({
  conversationId,
  disabled,
  state,
  onConversationChanged,
  onDraft,
  onStateChanged,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [instructions, setInstructions] = useState("");
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const pendingRef = useRef(false);
  const importInput = useRef<HTMLInputElement>(null);
  const items = useMemo(() => flattenTree(state?.tree ?? []), [state?.tree]);
  const selected = items.find((item) => item.id === selectedId);

  const run = async (key: string, action: () => Promise<void>) => {
    if (pendingRef.current || disabled) return;
    pendingRef.current = true;
    setPending(key);
    setError(undefined);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("error"));
    } finally {
      pendingRef.current = false;
      setPending(undefined);
    }
  };

  const fork = (position: "at" | "before") => {
    if (!selectedId) return;
    void run(position === "at" ? "clone" : "fork", async () => {
      const result = await api<{ id: string; selectedText?: string }>(
        `/api/conversations/${conversationId}/fork`,
        mutation("POST", { targetId: selectedId, position }),
      );
      if (result.selectedText) onDraft(result.selectedText, "replace");
      setOpen(false);
      await onConversationChanged(result.id);
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Tooltip content={t("conversationDetails")}>
        <Dialog.Trigger asChild>
          <IconButton
            aria-label={t("conversationDetails")}
            disabled={disabled}
            variant="ghost"
          >
            <DotsHorizontalIcon />
          </IconButton>
        </Dialog.Trigger>
      </Tooltip>
      <DialogPortal>
        <Dialog.Overlay className="dialogOverlay" />
        <Dialog.Content className="dialogContent conversationPanel">
          <Dialog.Title asChild>
            <Heading size="5">{t("conversationDetails")}</Heading>
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text as="p" color="gray" size="2">
              {t("conversationDetailsDescription")}
            </Text>
          </Dialog.Description>
          {error && (
            <Callout.Root color="red" role="alert">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          {state && state.sessionId === conversationId ? (
            <>
              <section
                className="conversationStats"
                aria-label={t("sessionStats")}
              >
                <div>
                  <Text color="gray" size="1">
                    {t("model")}
                  </Text>
                  <strong>{state.stats.model?.name ?? "—"}</strong>
                </div>
                <div>
                  <Text color="gray" size="1">
                    {t("messages")}
                  </Text>
                  <strong>{state.stats.totalMessages}</strong>
                </div>
                <div>
                  <Text color="gray" size="1">
                    {t("tokens")}
                  </Text>
                  <strong>{state.stats.tokens.total.toLocaleString()}</strong>
                </div>
                <div>
                  <Text color="gray" size="1">
                    {t("cost")}
                  </Text>
                  <strong>${state.stats.cost.toFixed(4)}</strong>
                </div>
                <div>
                  <Text color="gray" size="1">
                    {t("sessionSize")}
                  </Text>
                  <strong>{formatBytes(state.stats.sessionBytes)}</strong>
                </div>
                <div>
                  <Text color="gray" size="1">
                    {t("context")}
                  </Text>
                  <strong>
                    {state.stats.contextUsage?.percent === null ||
                    state.stats.contextUsage?.percent === undefined
                      ? "—"
                      : `${state.stats.contextUsage.percent.toFixed(1)}%`}
                  </strong>
                </div>
              </section>
              <section className="conversationPanelSection">
                <Heading size="3">{t("sessionTree")}</Heading>
                <ScrollArea className="sessionTreeScroll" tabIndex={0}>
                  <div className="sessionTree" role="tree">
                    {items.map((item) => (
                      <button
                        aria-selected={selectedId === item.id}
                        className={
                          selectedId === item.id
                            ? "sessionTreeItem selected"
                            : "sessionTreeItem"
                        }
                        key={item.id}
                        role="treeitem"
                        style={{
                          paddingInlineStart: `${8 + item.depth * 16}px`,
                        }}
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                      >
                        <span>{item.label || item.type}</span>
                        <small>{item.preview || item.id.slice(0, 8)}</small>
                      </button>
                    ))}
                    {items.length === 0 && (
                      <Text color="gray" size="2">
                        {t("emptySessionTree")}
                      </Text>
                    )}
                  </div>
                </ScrollArea>
                {state.treeTruncated && (
                  <Text color="amber" size="1">
                    {t("sessionTreeTruncated")}
                  </Text>
                )}
                <Flex gap="2" wrap="wrap">
                  <Button
                    disabled={!selectedId || Boolean(pending)}
                    variant="soft"
                    onClick={() =>
                      void run("navigate", async () => {
                        const result = await api<{
                          editorText?: string;
                          cancelled: boolean;
                        }>(
                          `/api/conversations/${conversationId}/tree/navigate`,
                          mutation("POST", { targetId: selectedId }),
                        );
                        if (result.editorText)
                          onDraft(result.editorText, "replace");
                        onStateChanged();
                        setOpen(false);
                      })
                    }
                  >
                    <CommitIcon /> {t("navigate")}
                  </Button>
                  <Button
                    disabled={
                      !selectedId ||
                      selected?.canForkBefore !== true ||
                      Boolean(pending)
                    }
                    variant="soft"
                    onClick={() => fork("before")}
                  >
                    {t("fork")}
                  </Button>
                  <Button
                    disabled={!selectedId || Boolean(pending)}
                    variant="soft"
                    onClick={() => fork("at")}
                  >
                    <CopyIcon /> {t("clone")}
                  </Button>
                </Flex>
              </section>
              <section className="conversationPanelSection">
                <Heading size="3">{t("compaction")}</Heading>
                <TextArea
                  aria-label={t("compactionInstructions")}
                  maxLength={10_000}
                  placeholder={t("compactionInstructions")}
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                />
                <Button
                  disabled={Boolean(pending)}
                  variant="soft"
                  onClick={() =>
                    void run("compact", async () => {
                      await api(
                        `/api/conversations/${conversationId}/compact`,
                        mutation("POST", {
                          ...(instructions.trim()
                            ? { customInstructions: instructions.trim() }
                            : {}),
                        }),
                      );
                      onStateChanged();
                    })
                  }
                >
                  {t("compactNow")}
                </Button>
              </section>
            </>
          ) : (
            <Text color="gray">{t("loading")}</Text>
          )}
          <section className="conversationPanelSection">
            <Heading size="3">{t("transfer")}</Heading>
            <Flex gap="2" wrap="wrap">
              <Button
                disabled={Boolean(pending)}
                variant="soft"
                onClick={() =>
                  window.location.assign(
                    `/api/conversations/${conversationId}/export/html`,
                  )
                }
              >
                <DownloadIcon /> HTML
              </Button>
              <Button
                disabled={Boolean(pending)}
                variant="soft"
                onClick={() =>
                  window.location.assign(
                    `/api/conversations/${conversationId}/export/jsonl`,
                  )
                }
              >
                <DownloadIcon /> JSONL
              </Button>
              <Button
                disabled={Boolean(pending)}
                variant="soft"
                onClick={() => importInput.current?.click()}
              >
                <UploadIcon /> {t("importSession")}
              </Button>
            </Flex>
            <input
              accept=".jsonl,application/x-ndjson,text/plain"
              hidden
              ref={importInput}
              type="file"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                void run("import", async () => {
                  if (file.size > 5_000_000)
                    throw new Error(t("sessionImportTooLarge"));
                  const result = await api<{ id: string }>(
                    "/api/conversations/import",
                    mutation("POST", { content: await file.text() }),
                  );
                  setOpen(false);
                  await onConversationChanged(result.id);
                });
              }}
            />
          </section>
          <Flex justify="end">
            <Dialog.Close asChild>
              <Button variant="soft">{t("close")}</Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </DialogPortal>
    </Dialog.Root>
  );
}
