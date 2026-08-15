import * as Dialog from "@radix-ui/react-dialog";
import { Button, Flex, Text } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import type { WorkspaceFile } from "../../shared/contracts.js";
import type { EditorAppearance, EditorSettings } from "../editor/config.js";
import { CodeDiffEditor } from "./CodeEditor.js";
import { DialogPortal } from "./DialogPortal.js";

interface Props {
  appearance: EditorAppearance;
  disk: WorkspaceFile;
  merged: string;
  open: boolean;
  settings: EditorSettings;
  onApply: () => void;
  onCancel: () => void;
  onMergedChange: (value: string) => void;
  onReload: () => void;
}

export function FileConflictDialog({
  appearance,
  disk,
  merged,
  open,
  settings,
  onApply,
  onCancel,
  onMergedChange,
  onReload,
}: Props) {
  const { t } = useTranslation();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogPortal>
        <Dialog.Overlay className="dialogOverlay" />
        <Dialog.Content className="dialogContent fileConflictDialog">
          <Dialog.Title className="dialogTitle">
            {t("filesConflictTitle")}
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text as="p" color="gray">
              {t("filesConflictDescription", { name: disk.name })}
            </Text>
          </Dialog.Description>
          <CodeDiffEditor
            appearance={appearance}
            modified={merged}
            modifiedLabel={t("filesConflictDraft")}
            original={disk.content ?? ""}
            originalLabel={t("filesConflictDisk")}
            path={disk.path}
            settings={settings}
            onModifiedChange={onMergedChange}
          />
          <Flex className="dialogActions" gap="2" justify="end" wrap="wrap">
            <Button
              highContrast
              type="button"
              variant="soft"
              onClick={onCancel}
            >
              {t("cancel")}
            </Button>
            <Button
              highContrast
              type="button"
              variant="soft"
              onClick={onReload}
            >
              {t("filesUseDiskVersion")}
            </Button>
            <Button highContrast type="button" onClick={onApply}>
              {t("filesApplyMergedDraft")}
            </Button>
          </Flex>
        </Dialog.Content>
      </DialogPortal>
    </Dialog.Root>
  );
}
