// @vitest-environment jsdom

import { Theme } from "@radix-ui/themes";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setLanguage } from "../../src/web/i18n.js";
import { LibraryPage } from "../../src/web/pages/LibraryPage.js";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
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

describe("Library package metadata", () => {
  test("uses opaque package IDs for update and removal", async () => {
    const mutations: Array<{ method: string; body: unknown }> = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/templates")
        return json([
          {
            name: "review",
            content: "Review changes",
            provenance: { scope: "project", origin: "top-level" },
          },
        ]);
      if (url === "/api/mcp") return json({ mcpServers: {} });
      if (url === "/api/diagnostics") return json({ mcp: [] });
      if (url === "/api/packages" && method === "GET")
        return json([
          {
            id: "pkg_opaque",
            name: "safe-package",
            scope: "user",
            filtered: false,
            provenance: { scope: "user", origin: "package" },
          },
        ]);
      if (
        (url === "/api/packages/update" && method === "POST") ||
        (url === "/api/packages" && method === "DELETE")
      ) {
        mutations.push({
          method,
          body: JSON.parse(String(init?.body)),
        });
        return json(method === "DELETE" ? { removed: true } : { ok: true });
      }
      if (url.startsWith("/api/documents/")) return json({ content: "" });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <LibraryPage />
      </Theme>,
    );

    await user.click(
      await screen.findByRole("tab", { name: /Prompt templates/ }),
    );
    expect(await screen.findByText("project")).toBeVisible();

    await user.click(await screen.findByRole("tab", { name: /Pi packages/ }));
    expect(await screen.findByText("safe-package")).toBeVisible();
    expect(screen.getByText("user package")).toBeVisible();
    expect(screen.queryByText(/private|workspace/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(mutations).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mutations).toHaveLength(2));

    expect(mutations).toEqual([
      {
        method: "POST",
        body: { id: "pkg_opaque", acknowledgeRisk: true },
      },
      {
        method: "DELETE",
        body: { id: "pkg_opaque", acknowledgeRisk: true },
      },
    ]);
  });
});
