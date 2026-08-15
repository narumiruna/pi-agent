import { expect, test } from "@playwright/test";
import { expectNoSeriousAccessibilityViolations } from "../support/test-helpers.js";

test("keyboard-manages prompts without overflow at 390px", async ({ page }) => {
  await page.goto("/prompts");
  await expect(page.getByRole("heading", { name: "Prompts" })).toBeVisible();
  const system = page.getByRole("textbox", { name: "System prompt" });
  await system.fill(`Mobile system prompt ${Date.now()}`);
  const systemSection = system.locator("xpath=ancestor::section[1]");
  const saveSystem = systemSection.getByRole("button", {
    name: "Save changes",
  });
  await saveSystem.focus();
  await page.keyboard.press("Enter");
  await expect(
    systemSection.getByText("Prompt document saved and Pi reloaded."),
  ).toBeVisible();

  const templatesTab = page.getByRole("tab", { name: "Prompt templates" });
  await templatesTab.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("tabpanel", { name: "Prompt templates" });
  const name = `mobile-template-${Date.now()}`;
  await panel.getByRole("textbox", { name: "Template name" }).fill(name);
  await panel
    .getByRole("textbox", { name: "Template content" })
    .fill("Mobile template content");
  const saveTemplate = panel.getByRole("button", { name: "Save changes" });
  await saveTemplate.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(`/${name}`, { exact: true })).toBeVisible();

  const edit = panel.getByRole("button", { name: `Edit template ${name}` });
  await edit.focus();
  await page.keyboard.press("Enter");
  await panel
    .getByRole("textbox", { name: "Template content" })
    .fill("Updated mobile template");
  await panel.getByRole("button", { name: "Save changes" }).click();
  await expect(panel.getByText("Updated mobile template")).toBeVisible();

  const remove = panel.getByRole("button", { name: `Delete template ${name}` });
  await expect(remove).toBeEnabled();
  const deleted = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/templates/${name}`) &&
      response.request().method() === "DELETE",
  );
  await remove.focus();
  await remove.press("Enter");
  expect((await deleted).status()).toBe(204);
  await expect(panel.getByText(`/${name}`, { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expectNoSeriousAccessibilityViolations(page);
});
