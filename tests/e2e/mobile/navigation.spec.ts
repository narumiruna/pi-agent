import { expect, test } from "@playwright/test";
import {
  appOrigin,
  expectNoSeriousAccessibilityViolations,
} from "../support/test-helpers.js";

test("keeps navigation and model selection keyboard operable at 390px", async ({
  page,
}) => {
  await page.goto("/");
  const modelSetup = await page.request.put("/api/model", {
    data: { provider: "e2e", modelId: "e2e-secondary" },
    headers: { origin: appOrigin },
  });
  expect(modelSetup.ok()).toBe(true);
  const menu = page.getByRole("button", { name: "Open navigation" });
  await expect(menu).toBeVisible();
  await menu.click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText(
    "Packages, skills, extensions, and MCP servers are trusted code",
  );

  await page.getByRole("button", { name: "Change model" }).click();
  const radios = page.getByRole("radio");
  const count = await radios.count();
  expect(count).toBeGreaterThan(1);
  let checkedIndex = -1;
  for (let index = 0; index < count; index += 1) {
    if (await radios.nth(index).isChecked()) checkedIndex = index;
  }
  expect(checkedIndex).toBeGreaterThanOrEqual(0);
  const target = radios.nth((checkedIndex + 1) % count);
  await target.focus();
  await page.keyboard.press("Enter");
  await expect(target).toBeChecked();
  await page.getByRole("button", { name: "Use this model" }).click();

  await menu.click();
  await page.getByRole("button", { name: "Chat" }).click();
  await expect(page.getByRole("region", { name: "Chat" })).toBeVisible();
  const template = await page.request.put("/api/templates/mobile-command", {
    data: { content: "A mobile command" },
    headers: { origin: appOrigin },
  });
  expect(template.ok()).toBe(true);
  await page.reload();
  const composer = page.getByLabel("Ask Pi anything…");
  await composer.fill("/mobile");
  await expect(
    page.getByRole("option", { name: /mobile-command/ }),
  ).toBeVisible();
  await composer.press("Escape");
  await expect(
    page.getByRole("option", { name: /mobile-command/ }),
  ).toHaveCount(0);
  const removeTemplate = await page.request.delete(
    "/api/templates/mobile-command",
    { headers: { origin: appOrigin } },
  );
  expect(removeTemplate.ok()).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expectNoSeriousAccessibilityViolations(page);
});
