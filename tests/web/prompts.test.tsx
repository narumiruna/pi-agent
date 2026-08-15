// @vitest-environment jsdom

import { Theme } from "@radix-ui/themes";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { WebPromptTemplateDocument } from "../../src/shared/contracts.js";
import { setLanguage } from "../../src/web/i18n.js";
import { PromptsPage } from "../../src/web/pages/PromptsPage.js";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderPage() {
  render(
    <Theme>
      <PromptsPage />
    </Theme>,
  );
}

beforeEach(async () => {
  await setLanguage("en");
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Prompts page", () => {
  test("saves system instructions once while a mutation is pending", async () => {
    let resolveSave: ((response: Response) => void) | undefined;
    const saves: unknown[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/templates") return json([]);
      if (url === "/api/documents/system" && !init?.method)
        return json({ content: "Original system" });
      if (url === "/api/documents/append" && !init?.method)
        return json({ content: "Original append" });
      if (url === "/api/documents/system" && init?.method === "PUT") {
        saves.push(JSON.parse(String(init.body)));
        return new Promise<Response>((resolve) => {
          resolveSave = resolve;
        });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    const user = userEvent.setup();
    renderPage();

    const system = await screen.findByRole("textbox", {
      name: "System prompt",
    });
    await user.clear(system);
    await user.type(system, "Updated system");
    const section = system.closest("section");
    if (!section) throw new Error("System prompt section was not rendered");
    await user.click(
      within(section).getByRole("button", { name: "Save changes" }),
    );

    const pendingSave = within(section).getByRole("button", {
      name: "Saving…",
    });
    expect(pendingSave).toBeDisabled();
    expect(saves).toEqual([{ content: "Updated system" }]);
    await act(async () => resolveSave?.(json({ ok: true })));
    expect(
      await within(section).findByText(
        "Prompt document saved and Pi reloaded.",
      ),
    ).toBeVisible();
    expect(saves).toHaveLength(1);
  });

  test("creates, edits, and deletes user templates without renaming selected files", async () => {
    let templates: WebPromptTemplateDocument[] = [
      {
        name: "review",
        content: "Review changes",
        provenance: { scope: "user", origin: "top-level" },
      },
    ];
    const mutations: Array<{ method: string; name: string; body?: unknown }> =
      [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/documents/") && method === "GET")
        return json({ content: "" });
      if (url === "/api/templates" && method === "GET") return json(templates);
      if (url.startsWith("/api/templates/") && method === "PUT") {
        const name = decodeURIComponent(url.slice("/api/templates/".length));
        const body = JSON.parse(String(init?.body)) as { content: string };
        mutations.push({ method, name, body });
        templates = [
          ...templates.filter((template) => template.name !== name),
          {
            name,
            content: body.content,
            provenance: { scope: "user", origin: "top-level" },
          },
        ];
        return json({ ok: true });
      }
      if (url.startsWith("/api/templates/") && method === "DELETE") {
        const name = decodeURIComponent(url.slice("/api/templates/".length));
        mutations.push({ method, name });
        templates = templates.filter((template) => template.name !== name);
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("tab", { name: /Prompt templates/ }),
    );
    const panel = screen.getByRole("tabpanel", { name: /Prompt templates/ });
    await user.click(
      within(panel).getByRole("button", { name: "Edit template review" }),
    );
    const name = within(panel).getByRole("textbox", { name: "Template name" });
    const content = within(panel).getByRole("textbox", {
      name: "Template content",
    });
    expect(name).toBeDisabled();
    await user.clear(content);
    await user.type(content, "Updated review");
    await user.click(
      within(panel).getByRole("button", { name: "Save changes" }),
    );
    expect(await within(panel).findByText("Updated review")).toBeVisible();

    await user.type(name, "daily");
    await user.type(content, "Daily instructions");
    await user.click(
      within(panel).getByRole("button", { name: "Save changes" }),
    );
    expect(await within(panel).findByText("/daily")).toBeVisible();

    await user.click(
      within(panel).getByRole("button", { name: "Delete template daily" }),
    );
    await waitFor(() => expect(within(panel).queryByText("/daily")).toBeNull());
    expect(mutations).toEqual([
      {
        method: "PUT",
        name: "review",
        body: { content: "Updated review" },
      },
      {
        method: "PUT",
        name: "daily",
        body: { content: "Daily instructions" },
      },
      { method: "DELETE", name: "daily" },
    ]);
  });

  test("retries load failures and exposes document mutation failures", async () => {
    let systemLoads = 0;
    let templateLoads = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/templates") {
        templateLoads++;
        return templateLoads === 1
          ? json({ error: { code: "internal_error" } }, 500)
          : json([]);
      }
      if (url === "/api/documents/system" && method === "GET") {
        systemLoads++;
        return systemLoads === 1
          ? json({ error: { code: "internal_error" } }, 500)
          : json({ content: "Loaded" });
      }
      if (url === "/api/documents/append" && method === "GET")
        return json({ content: "Loaded append" });
      if (url === "/api/documents/system" && method === "PUT")
        return json({ error: { code: "internal_error" } }, 500);
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderPage();

    const system = screen.getByRole("textbox", { name: "System prompt" });
    const systemSection = system.closest("section");
    if (!systemSection)
      throw new Error("System prompt section was not rendered");
    expect(await within(systemSection).findByRole("alert")).toHaveTextContent(
      "Could not load this prompt document.",
    );
    await user.click(
      within(systemSection).getByRole("button", { name: "Try again" }),
    );
    await waitFor(() => expect(system).toBeEnabled());
    expect(system).toHaveValue("Loaded");
    expect(systemLoads).toBe(2);
    await user.click(
      within(systemSection).getByRole("button", { name: "Save changes" }),
    );
    expect(await within(systemSection).findByRole("alert")).toHaveTextContent(
      "Could not save this prompt document.",
    );

    await user.click(screen.getByRole("tab", { name: /Prompt templates/ }));
    const panel = screen.getByRole("tabpanel", { name: /Prompt templates/ });
    expect(within(panel).getByRole("alert")).toHaveTextContent(
      "Could not load prompt templates.",
    );
    await user.click(within(panel).getByRole("button", { name: "Try again" }));
    expect(
      await within(panel).findByText("No user prompt templates yet."),
    ).toBeVisible();
    expect(templateLoads).toBe(2);
  });
});
