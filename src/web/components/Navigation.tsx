import * as Dialog from "@radix-ui/react-dialog";
import {
  ChatBubbleIcon,
  Cross1Icon,
  FileIcon,
  GearIcon,
  HamburgerMenuIcon,
  HeartIcon,
  PlusIcon,
  ReaderIcon,
} from "@radix-ui/react-icons";
import {
  Button,
  IconButton,
  ScrollArea,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import {
  type NavigationIconKey,
  type PrimaryNavigationItem,
  primaryNavigationFor,
} from "../navigation.js";
import type { Page } from "../routes.js";
import type { Conversation } from "../types.js";
import { DialogPortal } from "./DialogPortal.js";

interface Props {
  page: Page;
  authenticated: boolean;
  conversations: Conversation[];
  activeId?: string;
  mobileOpen: boolean;
  newPending: boolean;
  onMobileOpen: (open: boolean) => void;
  onPage: (page: Page) => void;
  onConversation: (id: string) => void;
  onNew: () => void;
}

const NAVIGATION_ICONS: Record<NavigationIconKey, typeof ChatBubbleIcon> = {
  chat: ChatBubbleIcon,
  file: FileIcon,
  heartbeat: HeartIcon,
  library: ReaderIcon,
  settings: GearIcon,
};

interface NavContentProps extends Props {
  items: readonly PrimaryNavigationItem[];
}

function NavContent(props: NavContentProps) {
  const { t } = useTranslation();
  return (
    <div className="navContent">
      <div className="brand">
        <span className="brandMark">π</span>
        <Text weight="bold">{t("appName")}</Text>
      </div>
      <nav className="primaryNav" aria-label="Primary">
        {props.items.map(({ page, labelKey, icon, pulse }) => {
          const Icon = NAVIGATION_ICONS[icon];
          return (
            <button
              type="button"
              key={page}
              className={props.page === page ? "navItem active" : "navItem"}
              onClick={() => {
                props.onPage(page);
                props.onMobileOpen(false);
              }}
            >
              <Icon />
              <span>{t(labelKey)}</span>
              {pulse && <span className="pulseRail" aria-hidden="true" />}
            </button>
          );
        })}
      </nav>
      <div className="conversationHeader">
        <Text size="1" color="gray">
          {t("chat")}
        </Text>
        <Tooltip content={t("newConversation")}>
          <IconButton
            size="1"
            variant="ghost"
            aria-label={t("newConversation")}
            disabled={props.newPending}
            onClick={props.onNew}
          >
            <PlusIcon />
          </IconButton>
        </Tooltip>
      </div>
      <ScrollArea className="conversationScroll">
        <div className="conversationList">
          {props.conversations.map((conversation) => (
            <button
              type="button"
              aria-label={conversation.name ?? conversation.id}
              title={conversation.name ?? conversation.id}
              key={conversation.id}
              disabled={props.newPending}
              className={
                props.activeId === conversation.id
                  ? "conversationItem active"
                  : "conversationItem"
              }
              onClick={() => {
                props.onConversation(conversation.id);
                props.onMobileOpen(false);
              }}
            >
              {conversation.name || conversation.id.slice(-8)}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export function Navigation(props: Props) {
  const { t } = useTranslation();
  const items = primaryNavigationFor({ authenticated: props.authenticated });
  return (
    <>
      <aside className="sidebar">
        <NavContent {...props} items={items} />
      </aside>
      <Dialog.Root open={props.mobileOpen} onOpenChange={props.onMobileOpen}>
        <Dialog.Trigger asChild>
          <IconButton
            className="mobileMenu"
            variant="soft"
            aria-label={t("menu")}
          >
            <HamburgerMenuIcon />
          </IconButton>
        </Dialog.Trigger>
        <DialogPortal>
          <Dialog.Overlay className="dialogOverlay" />
          <Dialog.Content className="mobileNavigation">
            <Dialog.Title className="srOnly">{t("menu")}</Dialog.Title>
            <Dialog.Close asChild>
              <Button
                className="mobileClose"
                variant="ghost"
                aria-label={t("close")}
              >
                <Cross1Icon />
              </Button>
            </Dialog.Close>
            <NavContent {...props} items={items} />
          </Dialog.Content>
        </DialogPortal>
      </Dialog.Root>
    </>
  );
}
