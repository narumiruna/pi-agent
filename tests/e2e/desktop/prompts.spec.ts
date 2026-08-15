import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("persists system instructions and manages user prompt templates", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Prompts" }).click();
  await expect(page).toHaveURL(/\/prompts$/);
  const systemContent = `E2E system instructions ${Date.now()}`;
  const system = page.getByRole("textbox", { name: "System prompt" });
  await system.fill(systemContent);
  const systemSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/documents/system") &&
      response.request().method() === "PUT",
  );
  await system
    .locator("xpath=ancestor::section[1]")
    .getByRole("button", { name: "Save changes" })
    .click();
  expect((await systemSaved).status()).toBe(200);
  await expect(
    page.getByText("Prompt document saved and Pi reloaded."),
  ).toBeVisible();
  await expect(
    readFile(resolve(".local/e2e/runtime/agent/SYSTEM.md"), "utf8"),
  ).resolves.toBe(systemContent);

  await page.reload();
  await expect(page).toHaveURL(/\/prompts$/);
  await expect(
    page.getByRole("textbox", { name: "System prompt" }),
  ).toHaveValue(systemContent);

  await page.getByRole("tab", { name: "Prompt templates" }).click();
  const panel = page.getByRole("tabpanel", { name: "Prompt templates" });
  const templateName = `e2e-template-${Date.now()}`;
  const templatePath = resolve(
    `.local/e2e/runtime/agent/prompts/${templateName}.md`,
  );
  await panel
    .getByRole("textbox", { name: "Template name" })
    .fill(templateName);
  await panel
    .getByRole("textbox", { name: "Template content" })
    .fill("Review the E2E result.");
  await panel.getByRole("button", { name: "Save changes" }).click();
  await expect(
    panel.getByText(`/${templateName}`, { exact: true }),
  ).toBeVisible();
  await expect(readFile(templatePath, "utf8")).resolves.toBe(
    "Review the E2E result.",
  );

  await panel
    .getByRole("button", { name: `Edit template ${templateName}` })
    .click();
  await expect(
    panel.getByRole("textbox", { name: "Template name" }),
  ).toBeDisabled();
  await panel
    .getByRole("textbox", { name: "Template content" })
    .fill("Updated E2E review.");
  await panel.getByRole("button", { name: "Save changes" }).click();
  await expect(readFile(templatePath, "utf8")).resolves.toBe(
    "Updated E2E review.",
  );

  await panel
    .getByRole("button", { name: `Delete template ${templateName}` })
    .click();
  await expect(
    panel.getByText(`/${templateName}`, { exact: true }),
  ).toHaveCount(0);
  await expect(access(templatePath)).rejects.toMatchObject({ code: "ENOENT" });
});
