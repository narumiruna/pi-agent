import { expect, test } from "@playwright/test";
import { expectNoSeriousAccessibilityViolations } from "../support/test-helpers.js";

test("keeps Files browsing and dirty navigation usable at 390px", async ({
  page,
}) => {
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Open navigation" });
  await menu.click();
  await page.getByRole("button", { name: "Files" }).click();
  await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();

  await page.getByRole("button", { name: /src.*Directory/i }).click();
  await page.getByRole("button", { name: /existing\.ts/i }).click();
  const editor = page.getByLabel("Contents of existing.ts");
  await expect(editor).toBeVisible();
  await expect(
    page.locator(
      '[data-editor-mode="plain"][data-editor-language="typescript"]',
    ),
  ).toBeVisible();
  await expect(page.locator(".monaco-editor")).toHaveCount(0);
  await editor.press("End");
  await editor.pressSequentially("// unsaved mobile change");

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expectNoSeriousAccessibilityViolations(page);

  await menu.click();
  await page.getByRole("button", { name: "Chats" }).click();
  await expect(page.getByText("Discard unsaved changes?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  await expect(editor).toHaveValue(/unsaved mobile change/);

  await menu.click();
  await page.getByRole("button", { name: "Chats" }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByRole("region", { name: "Chats" })).toBeVisible();
});
