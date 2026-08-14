import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("persists system instructions and manages a prompt template", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  const systemContent = `E2E system instructions ${Date.now()}`;
  await page
    .getByRole("textbox", { name: "System prompt" })
    .fill(systemContent);
  const systemSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/documents/system") &&
      response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save changes" }).first().click();
  expect((await systemSaved).status()).toBe(200);
  await expect(
    readFile(resolve(".local/e2e/runtime/agent/SYSTEM.md"), "utf8"),
  ).resolves.toBe(systemContent);

  await page.reload();
  await page.getByRole("button", { name: "Library" }).click();
  await expect(
    page.getByRole("textbox", { name: "System prompt" }),
  ).toHaveValue(systemContent);

  await page.getByRole("tab", { name: "Prompt templates" }).click();
  const panel = page.getByRole("tabpanel", { name: "Prompt templates" });
  const templateName = `e2e-template-${Date.now()}`;
  const templateContent = "Review the E2E result.";
  await panel.getByPlaceholder("daily-review").fill(templateName);
  await panel.getByRole("textbox").nth(1).fill(templateContent);
  await panel.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText(`/${templateName}`, { exact: true }),
  ).toBeVisible();
  await expect(
    readFile(
      resolve(`.local/e2e/runtime/agent/prompts/${templateName}.md`),
      "utf8",
    ),
  ).resolves.toBe(templateContent);

  await page.getByRole("button", { name: "Delete" }).last().click();
  await expect(page.getByText(`/${templateName}`, { exact: true })).toHaveCount(
    0,
  );

  await page.getByRole("tab", { name: "MCP servers" }).click();
  const mcpPanel = page.getByRole("tabpanel", { name: "MCP servers" });
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
  await expect(
    readFile(resolve(".local/e2e/runtime/agent/mcp.json"), "utf8"),
  ).resolves.toContain('"mcpServers"');
});
