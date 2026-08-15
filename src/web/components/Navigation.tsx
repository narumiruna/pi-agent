import * as Dialog from "@radix-ui/react-dialog";
import {
  ChatBubbleIcon,
  Cross1Icon,
  DotsHorizontalIcon,
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
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type NavigationIconKey,
  type PrimaryNavigationItem,
  primaryNavigationFor,
} from "../navigation.js";
import type { Page } from "../routes.js";
import type { Conversation, ConversationFilters } from "../types.js";
import { ConversationManagementDialog } from "./ConversationManagementDialog.js";
import { DialogPortal } from "./DialogPortal.js";

interface Props {
  page: Page;
  authenticated: boolean;
  conversations: Conversation[];
  conversationFilters: ConversationFilters;
  activeId?: string;
  mobileOpen: boolean;
  newPending: boolean;
  onMobileOpen: (open: boolean) => void;
  onConversationFilters: (filters: ConversationFilters) => void;
  onDeleteConversation: (id: string) => Promise<void>;
  onPage: (page: Page) => void;
  onRenameConversation: (id: string, name: string) => Promise<void>;
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
  onManageConversation: (conversation: Conversation) => void;
}

function NavContent(props: NavContentProps) {
  const { t } = useTranslation();
  const updateFilters = (patch: Partial<ConversationFilters>) =>
    props.onConversationFilters({ ...props.conversationFilters, ...patch });
  const filtersActive =
    props.conversationFilters.search !== "" ||
    props.conversationFilters.name !== "all" ||
    props.conversationFilters.sort !== "threaded";
  return (
    <div className="navContent">
      <div className="brand">
        <span className="brandMark">π</span>
        <Text weight="bold">{t("appName")}</Text>
      </div>
      <nav className="primaryNav" aria-label={t("primaryNavigation")}>
        {props.items.map(({ page, labelKey, icon, pulse }) => {
          const Icon = NAVIGATION_ICONS[icon];
          return (
            <button
              type="button"
              key={page}
              className={props.page === page ? "navItem active" : "navItem"}
              aria-current={props.page === page ? "page" : undefined}
              onClick={() => {
                props.onPage(page);
                props.onMobileOpen(false);
              }}
            >
              <Icon aria-hidden="true" />
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
            onClick={() => {
              props.onNew();
              props.onMobileOpen(false);
            }}
          >
            <PlusIcon />
          </IconButton>
        </Tooltip>
      </div>
      <search
        className="conversationDiscovery"
        aria-label={t("conversationDiscovery")}
      >
        <label className="conversationSearch">
          <span className="srOnly">{t("conversationSearch")}</span>
          <input
            type="search"
            value={props.conversationFilters.search}
            maxLength={500}
            placeholder={t("conversationSearchPlaceholder")}
            title={t("conversationSearchHint")}
            onChange={(event) => updateFilters({ search: event.target.value })}
          />
        </label>
        <div className="conversationFilterFields">
          <label>
            <span>{t("conversationNameFilter")}</span>
            <select
              value={props.conversationFilters.name}
              onChange={(event) =>
                updateFilters({
                  name: event.target.value as ConversationFilters["name"],
                })
              }
            >
              <option value="all">{t("conversationNameAll")}</option>
              <option value="named">{t("conversationNameNamed")}</option>
            </select>
          </label>
          <label>
            <span>{t("conversationSort")}</span>
            <select
              value={props.conversationFilters.sort}
              onChange={(event) =>
                updateFilters({
                  sort: event.target.value as ConversationFilters["sort"],
                })
              }
            >
              <option value="threaded">{t("conversationSortThreaded")}</option>
              <option value="recent">{t("conversationSortRecent")}</option>
              <option value="relevance">{t("conversationSortFuzzy")}</option>
            </select>
          </label>
        </div>
        <div className="conversationDiscoveryFooter">
          <Text size="1" color="gray" aria-live="polite">
            {t("conversationResults", { count: props.conversations.length })}
          </Text>
          <button
            type="button"
            className="conversationReset"
            disabled={!filtersActive}
            onClick={() =>
              props.onConversationFilters({
                search: "",
                name: "all",
                sort: "threaded",
              })
            }
          >
            {t("conversationReset")}
          </button>
        </div>
      </search>
      <ScrollArea className="conversationScroll">
        <div className="conversationList">
          {props.conversations.length === 0 ? (
            <Text className="conversationEmpty" size="1" color="gray">
              {t("conversationNoResults")}
            </Text>
          ) : (
            props.conversations.map((conversation) => {
              const label = conversation.name || conversation.id.slice(-8);
              const managementLabel = conversation.name ?? conversation.id;
              return (
                <div className="conversationRow" key={conversation.id}>
                  <button
                    type="button"
                    aria-label={conversation.name ?? conversation.id}
                    title={conversation.name ?? conversation.id}
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
                    {label}
                  </button>
                  <Tooltip content={t("manageConversation")}>
                    <IconButton
                      aria-label={t("manageConversationNamed", {
                        name: managementLabel,
                      })}
                      className="conversationManage"
                      disabled={props.newPending}
                      size="1"
                      variant="ghost"
                      onClick={() => props.onManageConversation(conversation)}
                    >
                      <DotsHorizontalIcon />
                    </IconButton>
                  </Tooltip>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function Navigation(props: Props) {
  const { t } = useTranslation();
  const [managedConversation, setManagedConversation] =
    useState<Conversation>();
  const [queuedManagement, setQueuedManagement] = useState<Conversation>();
  const items = primaryNavigationFor({ authenticated: props.authenticated });
  useEffect(() => {
    if (props.mobileOpen || !queuedManagement) return;
    setManagedConversation(queuedManagement);
    setQueuedManagement(undefined);
  }, [props.mobileOpen, queuedManagement]);
  const manageConversation = (conversation: Conversation) => {
    if (props.mobileOpen) {
      setQueuedManagement(conversation);
      props.onMobileOpen(false);
    } else {
      setManagedConversation(conversation);
    }
  };
  return (
    <>
      <aside className="sidebar">
        <NavContent
          {...props}
          items={items}
          onManageConversation={manageConversation}
        />
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
            <NavContent
              {...props}
              items={items}
              onManageConversation={manageConversation}
            />
          </Dialog.Content>
        </DialogPortal>
      </Dialog.Root>
      <ConversationManagementDialog
        conversation={managedConversation}
        disabled={props.newPending}
        open={Boolean(managedConversation)}
        onDelete={props.onDeleteConversation}
        onOpenChange={(open) => {
          if (!open) setManagedConversation(undefined);
        }}
        onRename={props.onRenameConversation}
      />
    </>
  );
}
