// @vitest-environment jsdom

import { Theme } from "@radix-ui/themes";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { WebSkillInventory } from "../../src/shared/contracts.js";
import { setLanguage } from "../../src/web/i18n.js";
import { SkillsPage } from "../../src/web/pages/SkillsPage.js";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function inventory(): WebSkillInventory {
  return {
    skills: [
      {
        id: "skill_global",
        name: "global-review",
        description: "Review changes with global guidance.",
        provenance: { scope: "user", origin: "top-level" },
        source: "local",
        path: "~/.pi/agent/skills/global-review/SKILL.md",
        files: [
          { path: "SKILL.md", size: 80, kind: "text", entry: true },
          {
            path: "references/guide.md",
            size: 15,
            kind: "text",
            entry: false,
          },
          {
            path: "assets/logo.png",
            size: 2_048,
            kind: "binary",
            entry: false,
          },
          {
            path: "assets/archive.zip",
            size: 600_000,
            kind: "too_large",
            entry: false,
          },
        ],
        filesTruncated: false,
      },
      {
        id: "skill_package",
        name: "package-review",
        description: "Review from a package.",
        provenance: { scope: "project", origin: "package" },
        source: "example.com/org/skills",
        path: "packages/example.com/org/skills/skills/review/SKILL.md",
        files: [{ path: "SKILL.md", size: 40, kind: "text", entry: true }],
        filesTruncated: true,
      },
      {
        id: "skill_settings",
        name: "settings-review",
        description: "Configured skill.",
        provenance: { scope: "user", origin: "top-level" },
        source: "settings",
        path: "settings/settings-review/SKILL.md",
        files: [
          { path: "SKILL.md", size: 30, kind: "unavailable", entry: true },
        ],
        filesTruncated: false,
      },
    ],
    diagnostics: [
      {
        severity: "warning",
        message: "name contains invalid characters",
        path: "~/.pi/agent/skills/global-review/SKILL.md",
        skillId: "skill_global",
      },
      {
        severity: "warning",
        message: "description is required",
        path: "~/.pi/agent/skills/omitted/SKILL.md",
      },
    ],
    projectTrust: { required: true, trusted: false },
  };
}

function renderPage(refresh = 0) {
  return render(
    <Theme>
      <SkillsPage refresh={refresh} />
    </Theme>,
  );
}

beforeEach(async () => {
  await setLanguage("en");
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Skills page", () => {
  test("shows native provenance, warnings, file metadata, and text content", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/skill-inventory") return json(inventory());
      if (url === "/api/skills/skill_global/files?path=references%2Fguide.md")
        return json({
          path: "references/guide.md",
          size: 15,
          kind: "text",
          content: "Reference guide",
        });
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Skills" }),
    ).toBeVisible();
    expect(screen.getByText("user · local")).toBeVisible();
    expect(
      screen.getByText("project package · example.com/org/skills"),
    ).toBeVisible();
    expect(screen.getByText("user · settings")).toBeVisible();
    expect(
      screen.getByText(/Project skills stay hidden until project resources/),
    ).toBeVisible();
    expect(
      screen.getByText(
        "~/.pi/agent/skills/omitted/SKILL.md: description is required",
      ),
    ).toBeVisible();
    expect(screen.getByText("1 validation warning")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "View skill global-review" }),
    );
    const viewer = screen.getByRole("heading", {
      name: "global-review",
    }).parentElement?.parentElement;
    if (!viewer) throw new Error("Expected skill viewer");
    expect(within(viewer).getByText("SKILL.md")).toBeVisible();
    expect(
      within(viewer).getByText("Binary metadata only · 2.0 KB"),
    ).toBeVisible();
    expect(
      within(viewer).getByText("Too large to preview · 600.0 KB"),
    ).toBeVisible();
    expect(
      within(viewer).queryByRole("button", {
        name: "View skill file assets/logo.png",
      }),
    ).toBeNull();

    await user.click(
      within(viewer).getByRole("button", {
        name: "View skill file references/guide.md",
      }),
    );
    expect(await within(viewer).findByText("Reference guide")).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      "/api/skills/skill_global/files?path=references%2Fguide.md",
      expect.anything(),
    );
  });

  test("replaces stale selection and content when native inventory refreshes", async () => {
    let loads = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/skill-inventory") {
        loads += 1;
        return json(
          loads === 1
            ? inventory()
            : {
                skills: [],
                diagnostics: [],
                projectTrust: { required: false, trusted: true },
              },
        );
      }
      if (url === "/api/skills/skill_global/files?path=SKILL.md")
        return json({
          path: "SKILL.md",
          size: 4,
          kind: "text",
          content: "Old content",
        });
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();
    const view = renderPage();
    await user.click(
      await screen.findByRole("button", { name: "View skill global-review" }),
    );
    await user.click(
      screen.getByRole("button", { name: "View skill file SKILL.md" }),
    );
    expect(await screen.findByText("Old content")).toBeVisible();

    view.rerender(
      <Theme>
        <SkillsPage refresh={1} />
      </Theme>,
    );

    expect(
      await screen.findByText("No skills are currently discovered."),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "global-review" })).toBeNull();
    expect(screen.queryByText("Old content")).toBeNull();
    expect(loads).toBe(2);
  });

  test("offers inventory retry and reports file load failures", async () => {
    let inventoryLoads = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/skill-inventory") {
        inventoryLoads += 1;
        return inventoryLoads === 1
          ? json({ error: { code: "internal_error" } }, 500)
          : json(inventory());
      }
      if (url.includes("/api/skills/"))
        return json({ error: { code: "not_found" } }, 404);
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByText("Could not load discovered skills."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await user.click(
      await screen.findByRole("button", { name: "View skill global-review" }),
    );
    await user.click(
      screen.getByRole("button", { name: "View skill file SKILL.md" }),
    );
    expect(
      await screen.findByText("Could not load this skill file."),
    ).toBeVisible();
  });
});
