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
import type { WebPromptResource } from "../../src/shared/contracts.js";
import { setLanguage } from "../../src/web/i18n.js";
import { PromptsPage } from "../../src/web/pages/PromptsPage.js";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderPage(refresh = 0) {
  return render(
    <Theme>
      <PromptsPage refresh={refresh} />
    </Theme>,
  );
}

beforeEach(async () => {
  await setLanguage("en");
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn());
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

describe("Prompts page", () => {
  test("saves system instructions once while a mutation is pending", async () => {
    let resolveSave: ((response: Response) => void) | undefined;
    const saves: unknown[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/prompt-inventory")
        return json({
          prompts: [],
          projectTrust: { required: false, trusted: false },
        });
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

  test("enforces the UTF-8 filename limit before prompt creation", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/documents/") && method === "GET")
        return json({ content: "" });
      if (url === "/api/prompt-inventory" && method === "GET")
        return json({
          prompts: [],
          projectTrust: { required: false, trusted: false },
        });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("tab", { name: /Prompt templates/ }),
    );
    const panel = screen.getByRole("tabpanel", { name: /Prompt templates/ });
    const name = within(panel).getByRole("textbox", { name: "Template name" });
    const save = within(panel).getByRole("button", { name: "Save changes" });
    await user.type(name, "界".repeat(85));
    expect(save).toBeDisabled();

    await user.clear(name);
    await user.type(name, "界".repeat(84));
    expect(save).toBeEnabled();
  });

  test("creates, edits, and deletes user templates without renaming selected files", async () => {
    let templates: WebPromptResource[] = [
      {
        id: "prompt_review",
        name: "review",
        description: "Review changes",
        argumentHint: "<PR>",
        content: "Review changes",
        contentTruncated: false,
        provenance: { scope: "user", origin: "top-level" },
        source: "local",
        path: "~/.pi/agent/prompts/review.md",
        editable: true,
        deletable: true,
      },
    ];
    const mutations: Array<{ method: string; name: string; body?: unknown }> =
      [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/documents/") && method === "GET")
        return json({ content: "" });
      if (url === "/api/prompt-inventory" && method === "GET")
        return json({
          prompts: templates,
          projectTrust: { required: true, trusted: true },
        });
      if (url === "/api/prompts/prompt_review" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { content: string };
        mutations.push({ method, name: "prompt_review", body });
        templates = templates.map((template) =>
          template.id === "prompt_review"
            ? {
                ...template,
                content: body.content,
                description: body.content,
              }
            : template,
        );
        return json({ ok: true });
      }
      if (url === "/api/prompts" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          name: string;
          content: string;
          scope: "project" | "user";
        };
        mutations.push({ method, name: body.name, body });
        templates = [
          ...templates,
          {
            id: `prompt_${body.name}`,
            name: body.name,
            description: body.content,
            content: body.content,
            contentTruncated: false,
            provenance: { scope: body.scope, origin: "top-level" },
            source: "local",
            path:
              body.scope === "project"
                ? `.pi/prompts/${body.name}.md`
                : `~/.pi/agent/prompts/${body.name}.md`,
            editable: true,
            deletable: true,
          },
        ];
        return json({ ok: true }, 201);
      }
      if (url === "/api/prompts/prompt_daily" && method === "DELETE") {
        mutations.push({ method, name: "prompt_daily" });
        templates = templates.filter(
          (template) => template.id !== "prompt_daily",
        );
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

    await user.click(
      within(panel).getByRole("combobox", { name: "Create in" }),
    );
    await user.click(screen.getByRole("option", { name: "Project prompts" }));
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
        name: "prompt_review",
        body: { content: "Updated review" },
      },
      {
        method: "POST",
        name: "daily",
        body: {
          name: "daily",
          content: "Daily instructions",
          scope: "project",
        },
      },
      { method: "DELETE", name: "prompt_daily" },
    ]);
  });

  test("saves an intentionally empty prompt body", async () => {
    const resource: WebPromptResource = {
      id: "prompt_empty",
      name: "Existing_Name",
      description: "Can be cleared",
      content: "Initial body",
      contentTruncated: false,
      provenance: { scope: "user", origin: "top-level" },
      source: "local",
      path: "~/.pi/agent/prompts/Existing_Name.md",
      editable: true,
      deletable: true,
    };
    let saved: string | undefined;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/documents/") && method === "GET")
        return json({ content: "" });
      if (url === "/api/prompt-inventory" && method === "GET")
        return json({
          prompts: [resource],
          projectTrust: { required: false, trusted: false },
        });
      if (url === "/api/prompts/prompt_empty" && method === "PUT") {
        saved = (JSON.parse(String(init?.body)) as { content: string }).content;
        return json({ ok: true });
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
      within(panel).getByRole("button", {
        name: "Edit template Existing_Name",
      }),
    );
    await user.clear(
      within(panel).getByRole("textbox", { name: "Template content" }),
    );
    const save = within(panel).getByRole("button", { name: "Save changes" });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(saved).toBe(""));
  });

  test("reports successful persistence separately from refresh failure", async () => {
    const resource: WebPromptResource = {
      id: "prompt_refresh",
      name: "refresh",
      description: "Refresh test",
      content: "Initial",
      contentTruncated: false,
      provenance: { scope: "user", origin: "top-level" },
      source: "local",
      path: "~/.pi/agent/prompts/refresh.md",
      editable: true,
      deletable: true,
    };
    let promptLoads = 0;
    let mutations = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/documents/") && method === "GET")
        return json({ content: "" });
      if (url === "/api/prompt-inventory" && method === "GET") {
        promptLoads += 1;
        return promptLoads === 1
          ? json({
              prompts: [resource],
              projectTrust: { required: false, trusted: false },
            })
          : json({ error: { code: "internal_error" } }, 500);
      }
      if (url === "/api/prompts/prompt_refresh" && method === "PUT") {
        mutations += 1;
        return json({ ok: true });
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
      within(panel).getByRole("button", { name: "Edit template refresh" }),
    );
    await user.click(
      within(panel).getByRole("button", { name: "Save changes" }),
    );

    expect(
      await within(panel).findByText(
        /prompt saved and Pi reloaded, but the refreshed inventory/i,
      ),
    ).toBeVisible();
    expect(mutations).toBe(1);
    expect(
      within(panel).getByRole("textbox", { name: "Template name" }),
    ).toBeEnabled();
    expect(
      within(panel).getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  });

  test("reconciles stale editor permissions after a rejected mutation", async () => {
    const userResource: WebPromptResource = {
      id: "prompt_stale",
      name: "stale",
      description: "Editable winner",
      content: "Initial",
      contentTruncated: false,
      provenance: { scope: "project", origin: "top-level" },
      source: "local",
      path: ".pi/prompts/stale.md",
      editable: true,
      deletable: true,
    };
    const packageResource: WebPromptResource = {
      ...userResource,
      id: "prompt_package_stale",
      description: "Replacement package winner",
      provenance: { scope: "user", origin: "package" },
      source: "stale-package",
      path: "packages/stale-package/prompts/stale.md",
      editable: false,
      deletable: false,
    };
    let rejected = false;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/documents/") && method === "GET")
        return json({ content: "" });
      if (url === "/api/prompt-inventory" && method === "GET")
        return json({
          prompts: [rejected ? packageResource : userResource],
          projectTrust: rejected
            ? { required: true, trusted: false }
            : { required: true, trusted: true },
        });
      if (url === "/api/prompts/prompt_stale" && method === "PUT") {
        rejected = true;
        return json({ error: { code: "forbidden" } }, 403);
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
      within(panel).getByRole("button", { name: "Edit template stale" }),
    );
    await user.click(
      within(panel).getByRole("button", { name: "Save changes" }),
    );

    expect(
      await within(panel).findByText("Replacement package winner"),
    ).toBeVisible();
    expect(
      within(panel).getByRole("button", { name: "View template stale" }),
    ).toBeVisible();
    expect(
      within(panel).queryByRole("button", { name: "Delete template stale" }),
    ).toBeNull();
    expect(
      within(panel).getByRole("textbox", { name: "Template name" }),
    ).toBeEnabled();
    expect(
      within(panel).getByText("Could not save this prompt template."),
    ).toBeVisible();
  });

  test("resets create scope when project trust is revoked", async () => {
    let revoked = false;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/documents/") && method === "GET")
        return json({ content: "" });
      if (url === "/api/prompt-inventory" && method === "GET")
        return json({
          prompts: [],
          projectTrust: { required: true, trusted: !revoked },
        });
      if (url === "/api/prompts" && method === "POST") {
        revoked = true;
        return json({ error: { code: "forbidden" } }, 403);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("tab", { name: /Prompt templates/ }),
    );
    const panel = screen.getByRole("tabpanel", { name: /Prompt templates/ });
    const scope = within(panel).getByRole("combobox", { name: "Create in" });
    await user.click(scope);
    await user.click(screen.getByRole("option", { name: "Project prompts" }));
    await user.type(
      within(panel).getByRole("textbox", { name: "Template name" }),
      "project-new",
    );
    await user.click(
      within(panel).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => expect(scope).toHaveTextContent("User prompts"));
    await user.click(scope);
    expect(
      screen.getByRole("option", { name: "Project prompts" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  test("refreshes and reconciles discovery after an external reload", async () => {
    let reloaded = false;
    let failReload = true;
    const editable: WebPromptResource = {
      id: "prompt_external_user",
      name: "external",
      description: "User prompt",
      content: "User body",
      contentTruncated: false,
      provenance: { scope: "user", origin: "top-level" },
      source: "local",
      path: "~/.pi/agent/prompts/external.md",
      editable: true,
      deletable: true,
    };
    const replacement: WebPromptResource = {
      ...editable,
      id: "prompt_external_package",
      description: "Package replacement",
      provenance: { scope: "user", origin: "package" },
      source: "external-package",
      path: "packages/external-package/prompts/external.md",
      editable: false,
      deletable: false,
    };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/documents/") && method === "GET")
        return json({ content: "" });
      if (url === "/api/prompt-inventory" && method === "GET") {
        if (reloaded && failReload) {
          failReload = false;
          return json({ error: { code: "internal_error" } }, 500);
        }
        return json({
          prompts: [reloaded ? replacement : editable],
          projectTrust: { required: true, trusted: !reloaded },
        });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    const view = renderPage(0);

    await user.click(
      await screen.findByRole("tab", { name: /Prompt templates/ }),
    );
    const panel = screen.getByRole("tabpanel", { name: /Prompt templates/ });
    await user.click(
      within(panel).getByRole("button", { name: "Edit template external" }),
    );
    reloaded = true;
    view.rerender(
      <Theme>
        <PromptsPage refresh={1} />
      </Theme>,
    );

    await user.click(
      await within(panel).findByRole("button", { name: "Try again" }),
    );
    expect(await within(panel).findByText("Package replacement")).toBeVisible();
    expect(
      within(panel).getByRole("button", { name: "View template external" }),
    ).toBeVisible();
    expect(
      within(panel).getByRole("textbox", { name: "Template name" }),
    ).toBeEnabled();
  });

  test("preserves a dirty editor draft across an external reload", async () => {
    let reloaded = false;
    const resource: WebPromptResource = {
      id: "prompt_dirty",
      name: "dirty",
      description: "Original prompt",
      content: "Original body",
      contentTruncated: false,
      provenance: { scope: "user", origin: "top-level" },
      source: "local",
      path: "~/.pi/agent/prompts/dirty.md",
      editable: true,
      deletable: true,
    };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/documents/") && method === "GET")
        return json({ content: "" });
      if (url === "/api/prompt-inventory" && method === "GET")
        return json({
          prompts: [
            reloaded
              ? {
                  ...resource,
                  description: "Server update",
                  content: "Server body",
                }
              : resource,
          ],
          projectTrust: { required: false, trusted: false },
        });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    const view = renderPage(0);

    await user.click(
      await screen.findByRole("tab", { name: /Prompt templates/ }),
    );
    const panel = screen.getByRole("tabpanel", { name: /Prompt templates/ });
    await user.click(
      within(panel).getByRole("button", { name: "Edit template dirty" }),
    );
    const content = within(panel).getByRole("textbox", {
      name: "Template content",
    });
    await user.clear(content);
    await user.type(content, "Unsaved draft");
    reloaded = true;
    view.rerender(
      <Theme>
        <PromptsPage refresh={1} />
      </Theme>,
    );

    expect(await within(panel).findByText("Server update")).toBeVisible();
    expect(content).toHaveValue("Unsaved draft");
    await user.click(within(panel).getByRole("button", { name: "Cancel" }));
    expect(
      within(panel).getByRole("textbox", { name: "Template name" }),
    ).toBeEnabled();
  });

  test("discards a dirty draft when its prompt becomes read-only", async () => {
    let readOnly = false;
    const resource: WebPromptResource = {
      id: "prompt_revoked",
      name: "revoked",
      description: "Editable prompt",
      content: "Editable body",
      contentTruncated: false,
      provenance: { scope: "project", origin: "top-level" },
      source: "local",
      path: ".pi/prompts/revoked.md",
      editable: true,
      deletable: true,
    };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/documents/") && method === "GET")
        return json({ content: "" });
      if (url === "/api/prompt-inventory" && method === "GET")
        return json({
          prompts: [
            readOnly
              ? {
                  ...resource,
                  description: "Authoritative read-only prompt",
                  content: "Authoritative read-only body",
                  editable: false,
                  deletable: false,
                }
              : resource,
          ],
          projectTrust: { required: true, trusted: !readOnly },
        });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    const view = renderPage(0);

    await user.click(
      await screen.findByRole("tab", { name: /Prompt templates/ }),
    );
    const panel = screen.getByRole("tabpanel", { name: /Prompt templates/ });
    await user.click(
      within(panel).getByRole("button", { name: "Edit template revoked" }),
    );
    const content = within(panel).getByRole("textbox", {
      name: "Template content",
    });
    await user.clear(content);
    await user.type(content, "Unsaved draft");
    readOnly = true;
    view.rerender(
      <Theme>
        <PromptsPage refresh={1} />
      </Theme>,
    );

    expect(
      await within(panel).findByText("Authoritative read-only prompt"),
    ).toBeVisible();
    expect(content).toHaveValue("Authoritative read-only body");
    expect(content).toHaveAttribute("readonly");
  });

  test("fails closed when inventory refresh fails after trust loss", async () => {
    let trustLost = false;
    const resource: WebPromptResource = {
      id: "prompt_failed_revocation",
      name: "failed-revocation",
      description: "Project prompt",
      content: "Project body",
      contentTruncated: false,
      provenance: { scope: "project", origin: "top-level" },
      source: "local",
      path: ".pi/prompts/failed-revocation.md",
      editable: true,
      deletable: true,
    };
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/documents/") && method === "GET")
        return json({ content: "" });
      if (url === "/api/prompt-inventory" && method === "GET")
        return trustLost
          ? json({ error: { code: "internal_error" } }, 500)
          : json({
              prompts: [resource],
              projectTrust: { required: true, trusted: true },
            });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    const view = renderPage(0);

    await user.click(
      await screen.findByRole("tab", { name: /Prompt templates/ }),
    );
    const panel = screen.getByRole("tabpanel", { name: /Prompt templates/ });
    await user.click(
      within(panel).getByRole("button", {
        name: "Edit template failed-revocation",
      }),
    );
    trustLost = true;
    view.rerender(
      <Theme>
        <PromptsPage refresh={1} />
      </Theme>,
    );

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Could not load prompt templates.",
    );
    expect(
      within(panel).getByRole("textbox", { name: "Template content" }),
    ).toHaveAttribute("readonly");
    expect(
      within(panel).queryByRole("button", { name: "Save changes" }),
    ).toBeNull();
  });

  test("ignores an older discovery response after saving", async () => {
    const original: WebPromptResource = {
      id: "prompt_sequence",
      name: "sequence",
      description: "Original inventory",
      content: "Original body",
      contentTruncated: false,
      provenance: { scope: "user", origin: "top-level" },
      source: "local",
      path: "~/.pi/agent/prompts/sequence.md",
      editable: true,
      deletable: true,
    };
    let current = original;
    let promptLoads = 0;
    let resolveStale: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/documents/") && method === "GET")
        return json({ content: "" });
      if (url === "/api/prompt-inventory" && method === "GET") {
        promptLoads += 1;
        if (promptLoads === 2)
          return new Promise<Response>((resolve) => {
            resolveStale = resolve;
          });
        return json({
          prompts: [current],
          projectTrust: { required: false, trusted: false },
        });
      }
      if (url === "/api/prompts/prompt_sequence" && method === "PUT") {
        current = {
          ...original,
          description: "Updated after save",
          content: "Updated body",
        };
        return json({ ok: true });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    const view = renderPage(0);

    await user.click(
      await screen.findByRole("tab", { name: /Prompt templates/ }),
    );
    const panel = screen.getByRole("tabpanel", { name: /Prompt templates/ });
    await user.click(
      within(panel).getByRole("button", { name: "Edit template sequence" }),
    );
    view.rerender(
      <Theme>
        <PromptsPage refresh={1} />
      </Theme>,
    );
    await waitFor(() => expect(resolveStale).toBeTypeOf("function"));
    await user.click(
      within(panel).getByRole("button", { name: "Save changes" }),
    );
    expect(await within(panel).findByText("Updated after save")).toBeVisible();

    await act(async () =>
      resolveStale?.(
        json({
          prompts: [original],
          projectTrust: { required: false, trusted: false },
        }),
      ),
    );
    expect(within(panel).getByText("Updated after save")).toBeVisible();
    expect(within(panel).queryByText("Original inventory")).toBeNull();
  });

  test("refreshes native discovery when deleting a collision winner", async () => {
    let trustLoads = 0;
    let resources: WebPromptResource[] = [
      {
        id: "prompt_user_review",
        name: "review",
        description: "User winner",
        content: "User winner",
        contentTruncated: false,
        provenance: { scope: "user", origin: "top-level" },
        source: "local",
        path: "~/.pi/agent/prompts/review.md",
        editable: true,
        deletable: true,
      },
    ];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/documents/") && method === "GET")
        return json({ content: "" });
      if (url === "/api/prompt-inventory" && method === "GET") {
        trustLoads += 1;
        return json({
          prompts: resources,
          projectTrust: { required: false, trusted: false },
        });
      }
      if (url === "/api/prompts/prompt_user_review" && method === "DELETE") {
        resources = [
          {
            id: "prompt_package_review",
            name: "review",
            description: "Revealed package prompt",
            content: "Package body",
            contentTruncated: false,
            provenance: { scope: "user", origin: "package" },
            source: "review-package",
            path: "packages/review-package/prompts/review.md",
            editable: false,
            deletable: false,
          },
        ];
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
    await user.click(
      within(panel).getByRole("button", { name: "Delete template review" }),
    );

    expect(
      await within(panel).findByRole("button", {
        name: "View template review",
      }),
    ).toBeVisible();
    expect(within(panel).getByText("Revealed package prompt")).toBeVisible();
    expect(
      within(panel).queryByRole("button", { name: "Delete template review" }),
    ).toBeNull();
    expect(
      within(panel).getByRole("textbox", { name: "Template name" }),
    ).toBeEnabled();
    expect(trustLoads).toBeGreaterThanOrEqual(2);
  });

  test("shows package and temporary prompts as path-safe read-only resources", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/documents/") && method === "GET")
        return json({ content: "" });
      if (url === "/api/prompt-inventory")
        return json({
          prompts: [
            {
              id: "prompt_package",
              name: "package-review",
              description: "Review from a package",
              argumentHint: "<PR>",
              content: "Read-only package body",
              contentTruncated: false,
              provenance: { scope: "user", origin: "package" },
              source: "example.com/org/prompts",
              path: "packages/example.com/org/prompts/prompts/review.md",
              editable: false,
              deletable: false,
            },
            {
              id: "prompt_temporary",
              name: "temporary-review",
              description: "Temporary review",
              content: "Temporary body",
              contentTruncated: false,
              provenance: { scope: "temporary", origin: "top-level" },
              source: "CLI",
              path: "temporary/review.md",
              editable: false,
              deletable: false,
            },
            {
              id: "prompt_extension",
              name: "extension-review",
              description: "Extension review",
              content: "Extension body",
              contentTruncated: false,
              provenance: { scope: "temporary", origin: "top-level" },
              source: "extension:review-tools",
              path: "temporary/extension-review.md",
              editable: false,
              deletable: false,
            },
          ],
          projectTrust: { required: true, trusted: false },
        });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("tab", { name: /Prompt templates/ }),
    );
    const panel = screen.getByRole("tabpanel", { name: /Prompt templates/ });
    const createName = within(panel).getByRole("textbox", {
      name: "Template name",
    });
    const createSave = within(panel).getByRole("button", {
      name: "Save changes",
    });
    await user.type(createName, "bad name");
    expect(createSave).toBeDisabled();
    await user.clear(createName);
    await user.type(createName, "Existing_Name.v2:review");
    expect(createSave).toBeEnabled();
    await user.clear(createName);
    expect(
      within(panel).getByText(/Use 1–200 non-space characters/),
    ).toBeVisible();
    expect(within(panel).getByText("user package · Read-only")).toBeVisible();
    expect(
      within(panel).getByText(
        "packages/example.com/org/prompts/prompts/review.md",
      ),
    ).toBeVisible();
    expect(
      within(panel).getByText("temporary/review.md", { exact: true }),
    ).toBeVisible();
    expect(
      within(panel).getByText("Source: extension:review-tools"),
    ).toBeVisible();
    await user.click(
      within(panel).getByRole("button", {
        name: "View template temporary-review",
      }),
    );
    const temporaryViewer = within(panel)
      .getByRole("heading", { name: "View template temporary-review" })
      .closest("section");
    if (!temporaryViewer) throw new Error("Temporary viewer was not rendered");
    expect(within(temporaryViewer).getByText("Source: CLI")).toBeVisible();
    expect(
      within(panel).getByRole("textbox", { name: "Template content" }),
    ).toHaveValue("Temporary body");
    await user.click(within(panel).getByRole("button", { name: "Close" }));
    expect(document.body.textContent).not.toMatch(/private|secret|token/);
    expect(
      within(panel).queryByRole("button", {
        name: "Delete template package-review",
      }),
    ).toBeNull();
    await user.click(
      within(panel).getByRole("combobox", { name: "Create in" }),
    );
    expect(
      screen.getByRole("option", { name: "Project prompts" }),
    ).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");

    await user.click(
      within(panel).getByRole("button", {
        name: "View template package-review",
      }),
    );
    expect(
      within(panel).getByRole("textbox", { name: "Template content" }),
    ).toHaveValue("Read-only package body");
    const readOnlyContent = within(panel).getByRole("textbox", {
      name: "Template content",
    });
    expect(readOnlyContent).toHaveAttribute("readonly");
    readOnlyContent.focus();
    expect(readOnlyContent).toHaveFocus();
    expect(
      within(panel).queryByRole("button", { name: "Save changes" }),
    ).toBeNull();
    expect(within(panel).getByText("Argument hint: <PR>")).toBeVisible();
    expect(within(panel).getByRole("button", { name: "Close" })).toBeVisible();
  });

  test("retries load failures and exposes document mutation failures", async () => {
    let systemLoads = 0;
    let templateLoads = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/prompt-inventory") {
        templateLoads++;
        return templateLoads === 1
          ? json({ error: { code: "internal_error" } }, 500)
          : json({
              prompts: [],
              projectTrust: { required: false, trusted: false },
            });
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
