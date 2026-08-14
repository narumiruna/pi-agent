import { CopyIcon, Cross2Icon, ExternalLinkIcon } from "@radix-ui/react-icons";
import { Button, Callout, Flex, IconButton, Text } from "@radix-ui/themes";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export interface AuthNotificationData {
  code?: string;
  message: string;
  url?: string;
  type?: "error" | "info" | "warning";
}

interface Props {
  embedded?: boolean;
  notification?: AuthNotificationData;
  onClose: () => void;
}

export function AuthNotification({
  embedded = false,
  notification,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [copiedCode, setCopiedCode] = useState<string>();
  if (!notification) return null;
  return (
    <Callout.Root
      className={`${embedded ? "embeddedNotification" : "notification"} authNotification`}
      color={
        notification.type === "error"
          ? "red"
          : notification.type === "warning"
            ? "amber"
            : undefined
      }
      role={notification.type === "error" ? "alert" : "status"}
    >
      <Flex align="start" gap="3" justify="between">
        <div className="authNotificationBody">
          <Callout.Text>{notification.message}</Callout.Text>
          {notification.code && (
            <Flex align="center" gap="2">
              <Text as="span" size="2">
                <code>{notification.code}</code>
              </Text>
              <Button
                size="1"
                variant="ghost"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(notification.code ?? "")
                    .then(() => setCopiedCode(notification.code))
                }
              >
                <CopyIcon />
                {copiedCode === notification.code ? t("copied") : t("copy")}
              </Button>
            </Flex>
          )}
          {notification.url && (
            <a
              className="authNotificationLink"
              href={notification.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLinkIcon /> {t("openProvider")}
            </a>
          )}
        </div>
        {!embedded && (
          <IconButton
            aria-label={t("close")}
            color="gray"
            size="1"
            variant="ghost"
            onClick={onClose}
          >
            <Cross2Icon />
          </IconButton>
        )}
      </Flex>
    </Callout.Root>
  );
}
