import { expect, test } from "@playwright/test";
import { expectNoSeriousAccessibilityViolations } from "../support/test-helpers.js";

test("has no serious accessibility violations in primary owner flows", async ({
  page,
}) => {
  await page.goto("/");
  await expectNoSeriousAccessibilityViolations(page);

  await page.getByRole("button", { name: "Files" }).click();
  await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.getByRole("button", { name: /src.*Directory/i }).click();
  await page.getByRole("button", { name: /existing\.ts/i }).click();
  const fileEditor = page.getByLabel("Contents of existing.ts");
  await expect(fileEditor).toHaveCount(1);
  const editorSurface = fileEditor.locator(
    "xpath=ancestor::div[contains(@class, 'monaco-editor')][1]",
  );
  await expect(editorSurface).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.getByRole("button", { name: "Editor settings" }).click();
  await expectNoSeriousAccessibilityViolations(page);
  await page
    .getByRole("combobox", { name: "Word wrap" })
    .selectOption("enabled");
  await page.getByRole("button", { name: "Done" }).click();
  await editorSurface.click();
  await page.keyboard.insertText(" unsaved");
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Tab inserts indentation" }).click();
  await editorSurface.click();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Workspace" }).click();
  await expect(page.getByText("Discard unsaved changes?")).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.getByRole("button", { name: "Discard changes" }).click();
  await page.getByRole("button", { name: /binary\.dat/i }).click();
  await expect(
    page.getByText("This file cannot be shown as text."),
  ).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  await page.getByRole("button", { name: "Settings" }).click();
  await expectNoSeriousAccessibilityViolations(page);
  await page.getByRole("button", { name: "Change model" }).click();
  await expectNoSeriousAccessibilityViolations(page);
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Heartbeat" }).click();
  await expectNoSeriousAccessibilityViolations(page);
});
