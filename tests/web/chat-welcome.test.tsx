// @vitest-environment jsdom

import { Theme } from "@radix-ui/themes";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setLanguage } from "../../src/web/i18n.js";
import { ChatPage } from "../../src/web/pages/ChatPage.js";

const defaultProps: ComponentProps<typeof ChatPage> = {
  conversationId: "session",
  refresh: 0,
  delta: "",
  thinking: "",
  running: false,
  inputDisabled: false,
  liveTools: [],
  eventsConnected: true,
  onRunning: vi.fn(),
  onConversationChanged: vi.fn(async () => undefined),
  onStateChanged: vi.fn(),
  onChooseModel: vi.fn(),
};

function chat(overrides: Partial<ComponentProps<typeof ChatPage>> = {}) {
  return (
    <Theme>
      <ChatPage {...defaultProps} {...overrides} />
    </Theme>
  );
}

beforeEach(async () => {
  await setLanguage("en");
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      const url = String(input);
      if (url === "/api/commands" || url === "/api/conversations/session") {
        return new Response(
          JSON.stringify(url === "/api/commands" ? [] : { messages: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("chat welcome starters", () => {
  test("appends a starter to an existing draft, focuses the composer, and does not send", async () => {
    const user = userEvent.setup();
    render(chat());
    const composer = await screen.findByLabelText("Ask Pi anything…");

    await user.type(composer, "Keep this draft");
    await user.click(screen.getByRole("button", { name: /Explore the code/i }));

    expect(composer).toHaveValue(
      "Keep this draft\n\nHelp me understand this project's structure and its main entry points.",
    );
    expect(composer).toHaveFocus();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/messages") && init?.method === "POST",
        ),
    ).toBe(false);
  });

  test("disables every starter while chat input is unavailable or Pi is running", async () => {
    const view = render(chat({ conversationId: undefined }));
    const starters = await screen.findAllByRole("button", {
      name: /Explore the code|Make it better|Think it through/i,
    });
    expect(starters).toHaveLength(3);
    for (const starter of starters) expect(starter).toBeDisabled();

    view.rerender(chat({ running: true }));
    await waitFor(() => {
      for (const starter of screen.getAllByRole("button", {
        name: /Explore the code|Make it better|Think it through/i,
      })) {
        expect(starter).toBeDisabled();
      }
    });
  });

  test("renders and selects localized Traditional Chinese starter content", async () => {
    await setLanguage("zh-TW");
    const user = userEvent.setup();
    render(chat());

    expect(await screen.findByText("今天，想一起完成什麼？")).toBeVisible();
    expect(screen.getByText("快速掌握專案架構與脈絡")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /探索程式碼/i }));

    const composer = screen.getByLabelText("交代 Pi 一件事…");
    expect(composer).toHaveValue("幫我了解這個專案的結構與主要進入點。");
    expect(composer).toHaveFocus();
  });
});
