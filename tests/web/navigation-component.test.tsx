// @vitest-environment jsdom

import { Theme } from "@radix-ui/themes";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Navigation } from "../../src/web/components/Navigation.js";
import { setLanguage } from "../../src/web/i18n.js";
import type { Conversation, ConversationFilters } from "../../src/web/types.js";

beforeEach(async () => {
  await setLanguage("en");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function renderNavigation(
  options: {
    page?: "chats" | "files" | "heartbeat" | "library" | "settings";
    mobileOpen?: boolean;
    conversationFilters?: ConversationFilters;
    conversations?: Conversation[];
    activeId?: string;
  } = {},
) {
  const onMobileOpen = vi.fn();
  const onConversationFilters = vi.fn();
  const onDeleteConversation = vi.fn(async () => undefined);
  const onPage = vi.fn();
  const onRenameConversation = vi.fn(async () => undefined);
  render(
    <Theme>
      <Navigation
        page={options.page ?? "files"}
        authenticated
        activeId={options.activeId}
        conversations={options.conversations ?? []}
        conversationFilters={
          options.conversationFilters ?? {
            search: "",
            name: "all",
            sort: "threaded",
          }
        }
        mobileOpen={options.mobileOpen ?? false}
        newPending={false}
        onMobileOpen={onMobileOpen}
        onConversationFilters={onConversationFilters}
        onDeleteConversation={onDeleteConversation}
        onPage={onPage}
        onRenameConversation={onRenameConversation}
        onConversation={vi.fn()}
        onNew={vi.fn()}
      />
    </Theme>,
  );
  return {
    onConversationFilters,
    onDeleteConversation,
    onMobileOpen,
    onPage,
    onRenameConversation,
  };
}

describe("Navigation accessibility", () => {
  test("exposes the current page in a localized landmark and uses native keyboard controls", async () => {
    const user = userEvent.setup();
    const { onMobileOpen, onPage } = renderNavigation();
    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    const files = within(navigation).getByRole("button", { name: "Files" });

    expect(files.tagName).toBe("BUTTON");
    expect(files).toHaveAttribute("aria-current", "page");
    expect(
      within(navigation).getByRole("button", { name: "Chats" }),
    ).not.toHaveAttribute("aria-current");

    files.focus();
    await user.keyboard("{Enter}");

    expect(onPage).toHaveBeenCalledWith("files");
    expect(onMobileOpen).toHaveBeenCalledWith(false);
  });

  test("searches, filters names, and selects native sort modes with keyboard controls", async () => {
    const user = userEvent.setup();
    const { onConversationFilters } = renderNavigation({ page: "chats" });
    const discovery = document.querySelector("search");
    expect(discovery).not.toBeNull();
    expect(discovery).toHaveAttribute("aria-label", "Find conversations");
    const content = within(discovery as HTMLElement);

    await user.type(
      content.getByRole("searchbox", { name: "Search conversations" }),
      "n",
    );
    await user.selectOptions(
      content.getByRole("combobox", { name: "Name" }),
      "named",
    );
    await user.selectOptions(
      content.getByRole("combobox", { name: "Sort" }),
      "relevance",
    );

    expect(onConversationFilters).toHaveBeenCalledWith(
      expect.objectContaining({ search: "n" }),
    );
    expect(onConversationFilters).toHaveBeenCalledWith(
      expect.objectContaining({ name: "named" }),
    );
    expect(onConversationFilters).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "relevance" }),
    );
  });

  test("renames and confirms deletion from a non-nested conversation row action", async () => {
    const user = userEvent.setup();
    const conversation: Conversation = {
      id: "managed-session",
      name: "Managed session",
      createdAt: new Date(0).toISOString(),
      modifiedAt: new Date(0).toISOString(),
      messageCount: 2,
      active: false,
    };
    const { onDeleteConversation, onRenameConversation } = renderNavigation({
      conversations: [conversation],
      activeId: "another-session",
    });

    const manage = screen
      .getAllByRole("button", { name: "Manage conversation Managed session" })
      .find((button) => !button.closest('[aria-hidden="true"]'));
    if (!manage) throw new Error("Visible management action was not rendered");
    await user.click(manage);
    const name = screen.getByRole("textbox", { name: "Conversation name" });
    await user.clear(name);
    await user.type(name, "Renamed session");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() =>
      expect(onRenameConversation).toHaveBeenCalledWith(
        "managed-session",
        "Renamed session",
      ),
    );

    await user.click(manage);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirmation = screen
      .getAllByRole("dialog")
      .find((dialog) => within(dialog).queryByText(/cannot be undone/i));
    if (!confirmation) throw new Error("Delete confirmation was not rendered");
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() =>
      expect(onDeleteConversation).toHaveBeenCalledWith("managed-session"),
    );
  });

  test("labels the open mobile dialog and exposes its active destination", async () => {
    const user = userEvent.setup();
    const { onMobileOpen } = renderNavigation({
      page: "settings",
      mobileOpen: true,
    });
    const trigger = document.querySelector<HTMLButtonElement>(".mobileMenu");
    const dialog = screen.getByRole("dialog", { name: "Open navigation" });
    const navigation = within(dialog).getByRole("navigation", {
      name: "Primary navigation",
    });

    expect(trigger).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      within(navigation).getByRole("button", { name: "Settings" }),
    ).toHaveAttribute("aria-current", "page");

    const close = within(dialog).getByRole("button", { name: "Close" });
    close.focus();
    await user.keyboard("{Enter}");

    expect(onMobileOpen).toHaveBeenCalledWith(false);
  });
});
