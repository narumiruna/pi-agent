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
  await expect(fileEditor).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await fileEditor.pressSequentially(" unsaved");
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
