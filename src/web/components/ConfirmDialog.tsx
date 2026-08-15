import * as Dialog from "@radix-ui/react-dialog";
import { Button, Flex, Text } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { DialogPortal } from "./DialogPortal.js";

interface Props {
  confirmLabel: string;
  description: string;
  destructive?: boolean;
  open: boolean;
  title: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function ConfirmDialog({
  confirmLabel,
  description,
  destructive = false,
  open,
  title,
  onConfirm,
  onOpenChange,
}: Props) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <Dialog.Overlay className="dialogOverlay" />
        <Dialog.Content className="dialogContent confirmDialog">
          <Dialog.Title className="dialogTitle">{title}</Dialog.Title>
          <Dialog.Description asChild>
            <Text as="p" color="gray">
              {description}
            </Text>
          </Dialog.Description>
          <Flex className="dialogActions" gap="2" justify="end">
            <Dialog.Close asChild>
              <Button highContrast variant="soft">
                {t("cancel")}
              </Button>
            </Dialog.Close>
            <Button
              highContrast
              color={destructive ? "red" : undefined}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </Flex>
        </Dialog.Content>
      </DialogPortal>
    </Dialog.Root>
  );
}
