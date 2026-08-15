import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("keeps package and MCP controls in Library", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await expect(page.getByRole("tab", { name: "Prompt templates" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("textbox", { name: "System prompt" }),
  ).toHaveCount(0);
  const packagePanel = page.getByRole("tabpanel", { name: "Pi packages" });
  await expect(packagePanel.getByRole("note")).toContainText(
    "Packages, skills, extensions, and MCP servers are trusted code",
  );

  await page.getByRole("tab", { name: "MCP servers" }).click();
  const mcpPanel = page.getByRole("tabpanel", { name: "MCP servers" });
  await expect(mcpPanel.getByRole("note")).toContainText(
    "container's permissions",
  );
  const mcpEditor = mcpPanel.getByRole("textbox", { name: "MCP servers" });
  await expect(mcpEditor).toBeEnabled();
  await mcpEditor.fill('{\n  "mcpServers": {}\n}\n');
  const mcpSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/mcp") &&
      response.request().method() === "PUT",
  );
  await mcpPanel.getByRole("button", { name: "Save changes" }).click();
  expect((await mcpSaved).status()).toBe(200);
  await expect(mcpPanel.getByRole("note")).toBeVisible();
  await expect(
    readFile(resolve(".local/e2e/runtime/agent/mcp.json"), "utf8"),
  ).resolves.toContain('"mcpServers"');
});
