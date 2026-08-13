// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../../src/web/App.js";
import { InteractionDialog } from "../../src/web/components/InteractionDialog.js";
import i18n, { setLanguage } from "../../src/web/i18n.js";

describe("web application", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  test("shows a focused OIDC login state for unauthenticated visitors", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<App />);

    expect(
      await screen.findByRole("button", { name: /Pocket ID/i }),
    ).toBeVisible();
    expect(screen.queryByText("Heartbeat")).not.toBeInTheDocument();
  });

  test("switches between English and Traditional Chinese without a reload", async () => {
    await setLanguage("en");
    expect(i18n.t("newConversation")).toBe("New conversation");

    await setLanguage("zh-TW");
    expect(i18n.t("newConversation")).toBe("新增對話");
    expect(window.localStorage.getItem("pi-agent-language")).toBe("zh-TW");
  });

  test("keeps interaction dialogs keyboard operable", async () => {
    const onClose = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(
      <InteractionDialog
        interaction={{ id: "one", kind: "input", title: "Your answer" }}
        onClose={onClose}
      />,
    );

    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Your answer" }),
      "hello",
    );
    await user.click(screen.getByRole("button", { name: i18n.t("continue") }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(
      "/api/interactions/one",
      expect.objectContaining({
        body: JSON.stringify({ value: "hello" }),
        method: "POST",
      }),
    );
  });

  test("responds to the broker when a dialog is cancelled", async () => {
    const onClose = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(
      <InteractionDialog
        interaction={{ id: "cancelled", kind: "confirm", title: "Continue?" }}
        onClose={onClose}
      />,
    );

    await userEvent.setup().keyboard("{Escape}");

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(
      "/api/interactions/cancelled",
      expect.objectContaining({ body: "{}", method: "POST" }),
    );
  });
});
