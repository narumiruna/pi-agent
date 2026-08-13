import * as Dialog from "@radix-ui/react-dialog";
import { Button, Flex, Text } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import type { ProviderOption } from "../model-access.js";

interface Props {
  currentProvider?: string;
  onConfirm: (provider: ProviderOption) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pending: boolean;
  provider?: ProviderOption;
}

export function DisconnectProviderDialog({
  currentProvider,
  onConfirm,
  onOpenChange,
  open,
  pending,
  provider,
}: Props) {
  const { t } = useTranslation();
  if (!provider) return null;
  const currentModelAffected = provider.id === currentProvider;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialogOverlay" />
        <Dialog.Content
          className="dialogContent"
          aria-describedby="disconnect-description"
        >
          <Dialog.Title className="dialogTitle">
            {t("disconnectProvider", { provider: provider.name })}
          </Dialog.Title>
          <Dialog.Description id="disconnect-description" asChild>
            <Text as="p" color="gray">
              {currentModelAffected
                ? t("disconnectCurrentModelWarning")
                : t("disconnectDescription")}
            </Text>
          </Dialog.Description>
          <Flex justify="end" gap="3" mt="5">
            <Button
              color="gray"
              variant="soft"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              color="red"
              disabled={pending}
              onClick={() =>
                void onConfirm(provider).then((removed) => {
                  if (removed) onOpenChange(false);
                })
              }
            >
              {pending ? t("disconnecting") : t("disconnect")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
