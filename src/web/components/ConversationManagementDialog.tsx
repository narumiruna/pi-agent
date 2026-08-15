import * as Dialog from "@radix-ui/react-dialog";
import {
  Button,
  Callout,
  Flex,
  Heading,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Conversation } from "../types.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { DialogPortal } from "./DialogPortal.js";

interface Props {
  conversation?: Conversation;
  disabled: boolean;
  open: boolean;
  onDelete: (id: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  onRename: (id: string, name: string) => Promise<void>;
}

export function ConversationManagementDialog({
  conversation,
  disabled,
  open,
  onDelete,
  onOpenChange,
  onRename,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const pendingRef = useRef(false);

  useEffect(() => {
    if (!open || !conversation) return;
    setName(conversation.name ?? "");
    setError(undefined);
    setConfirmDelete(false);
  }, [conversation, open]);

  const run = async (action: () => Promise<void>) => {
    if (pendingRef.current || disabled) return;
    pendingRef.current = true;
    setPending(true);
    setError(undefined);
    try {
      await action();
      setConfirmDelete(false);
      onOpenChange(false);
    } catch {
      setConfirmDelete(false);
      setError(t("conversationManagementFailed"));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const label = conversation?.name || conversation?.id || "";
  return (
    <>
      <Dialog.Root
        open={open && !confirmDelete}
        onOpenChange={(next) => {
          if (!pending && !confirmDelete) onOpenChange(next);
        }}
      >
        <DialogPortal>
          <Dialog.Overlay className="dialogOverlay" />
          <Dialog.Content className="dialogContent conversationManagementDialog">
            <Dialog.Title asChild>
              <Heading size="5">{t("manageConversation")}</Heading>
            </Dialog.Title>
            <Dialog.Description asChild>
              <Text as="p" color="gray" size="2">
                {t("manageConversationDescription")}
              </Text>
            </Dialog.Description>
            {error && (
              <Callout.Root color="red" role="alert">
                <Callout.Text>{error}</Callout.Text>
              </Callout.Root>
            )}
            <form
              className="conversationRenameForm"
              onSubmit={(event) => {
                event.preventDefault();
                const next = name.trim();
                if (!conversation || !next) return;
                void run(() => onRename(conversation.id, next));
              }}
            >
              <label htmlFor="conversation-management-name">
                <Text as="span" size="2" weight="medium">
                  {t("conversationName")}
                </Text>
                <TextField.Root
                  aria-label={t("conversationName")}
                  id="conversation-management-name"
                  autoFocus
                  disabled={disabled || pending}
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <Flex gap="2" justify="end">
                <Dialog.Close asChild>
                  <Button
                    disabled={pending}
                    highContrast
                    type="button"
                    variant="soft"
                  >
                    {t("cancel")}
                  </Button>
                </Dialog.Close>
                <Button
                  disabled={disabled || pending || !name.trim()}
                  highContrast
                  type="submit"
                >
                  {t("save")}
                </Button>
              </Flex>
            </form>
            <section className="conversationDangerZone">
              <Heading color="red" size="3">
                {t("deleteConversation")}
              </Heading>
              <Text as="p" color="gray" size="2">
                {conversation?.active
                  ? t("activeConversationDeleteHint")
                  : t("deleteConversationHint")}
              </Text>
              <Button
                color="red"
                disabled={disabled || pending || conversation?.active !== false}
                variant="soft"
                onClick={() => setConfirmDelete(true)}
              >
                {t("delete")}
              </Button>
            </section>
          </Dialog.Content>
        </DialogPortal>
      </Dialog.Root>
      <ConfirmDialog
        confirmLabel={t("delete")}
        description={t("deleteConversationDescription", { name: label })}
        destructive
        open={confirmDelete}
        pending={pending}
        title={t("deleteConversation")}
        onOpenChange={(next) => {
          if (!pending) setConfirmDelete(next);
        }}
        onConfirm={() => {
          if (!conversation || conversation.active) return;
          void run(() => onDelete(conversation.id));
        }}
      />
    </>
  );
}
