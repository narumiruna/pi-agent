import { test } from "@playwright/test";
import { expectNoSeriousAccessibilityViolations } from "../support/test-helpers.js";

test("has no serious accessibility violations in primary owner flows", async ({
  page,
}) => {
  await page.goto("/");
  await expectNoSeriousAccessibilityViolations(page);

  await page.getByRole("button", { name: "Settings" }).click();
  await expectNoSeriousAccessibilityViolations(page);
  await page.getByRole("button", { name: "Change model" }).click();
  await expectNoSeriousAccessibilityViolations(page);
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Heartbeat" }).click();
  await expectNoSeriousAccessibilityViolations(page);
});
