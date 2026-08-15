// @vitest-environment jsdom

import { Theme } from "@radix-ui/themes";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Navigation } from "../../src/web/components/Navigation.js";
import { setLanguage } from "../../src/web/i18n.js";

beforeEach(async () => {
  await setLanguage("en");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderNavigation(
  options: {
    page?: "chats" | "files" | "heartbeat" | "library" | "settings";
    mobileOpen?: boolean;
  } = {},
) {
  const onMobileOpen = vi.fn();
  const onPage = vi.fn();
  render(
    <Theme>
      <Navigation
        page={options.page ?? "files"}
        authenticated
        conversations={[]}
        mobileOpen={options.mobileOpen ?? false}
        newPending={false}
        onMobileOpen={onMobileOpen}
        onPage={onPage}
        onConversation={vi.fn()}
        onNew={vi.fn()}
      />
    </Theme>,
  );
  return { onMobileOpen, onPage };
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
