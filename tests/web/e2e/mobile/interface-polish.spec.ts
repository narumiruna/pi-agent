import { expect, test } from "@playwright/test";
import { expectNoSeriousAccessibilityViolations } from "../../../e2e/support/test-helpers.js";

test("keeps navigation, starter cards, and the composer bounded at 390px", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  const menu = page.getByRole("button", { name: "Open navigation" });
  await menu.click();
  const drawer = page.getByRole("dialog", { name: "Open navigation" });
  await expect(drawer.getByText("Your AI workspace")).toBeVisible();
  expect(
    await drawer.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("interface-polish-mobile-navigation-light.png"),
    fullPage: true,
  });
  await drawer.getByRole("button", { name: "New conversation" }).click();

  const starters = page.locator(".chatStarter");
  await expect(starters).toHaveCount(3);
  await expect(page.getByText("What would you like to build?")).toBeVisible();
  const firstBox = await starters.nth(0).boundingBox();
  const secondBox = await starters.nth(1).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(secondBox?.y ?? 0).toBeGreaterThanOrEqual(
    (firstBox?.y ?? 0) + (firstBox?.height ?? 0),
  );

  const composer = page.locator(".composer");
  const composerBox = await composer.boundingBox();
  const viewport = page.viewportSize();
  expect(composerBox).not.toBeNull();
  expect((composerBox?.x ?? 0) + (composerBox?.width ?? 0)).toBeLessThanOrEqual(
    viewport?.width ?? 390,
  );
  expect(
    (composerBox?.y ?? 0) + (composerBox?.height ?? 0),
  ).toBeLessThanOrEqual(viewport?.height ?? 844);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expectNoSeriousAccessibilityViolations(page);
  await page.screenshot({
    path: testInfo.outputPath("interface-polish-mobile-light.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: /Think it through/i }).click();
  const input = page.getByLabel("Ask Pi anything…");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(
    "Help me turn an idea into an implementation plan. Start by asking what I want to build.",
  );

  const lightCanvas = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--canvas"),
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--canvas"),
      ),
    )
    .not.toBe(lightCanvas);
  await expectNoSeriousAccessibilityViolations(page);
  await page.screenshot({
    path: testInfo.outputPath("interface-polish-mobile-dark.png"),
    fullPage: true,
  });
});
