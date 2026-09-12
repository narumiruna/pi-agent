import { expect, test } from "@playwright/test";
import { expectNoSeriousAccessibilityViolations } from "../../../e2e/support/test-helpers.js";

test("keeps the polished empty chat keyboard-accessible in light and dark themes", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).click();

  const welcome = page.getByText("What would you like to build?");
  const explore = page.getByRole("button", { name: /Explore the code/i });
  const composer = page.getByLabel("Ask Pi anything…");
  await expect(welcome).toBeVisible();
  await expect(explore).toBeEnabled();
  await expect(composer).toBeEnabled();
  await expectNoSeriousAccessibilityViolations(page);

  const lightCanvas = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--canvas"),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const composerBox = await page.locator(".composer").boundingBox();
  const headerBox = await page.locator(".chatHeader").boundingBox();
  const welcomeMarkBox = await page.locator(".welcomeMark").boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(composerBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(welcomeMarkBox).not.toBeNull();
  expect(welcomeMarkBox?.y ?? 0).toBeGreaterThanOrEqual(
    (headerBox?.y ?? 0) + (headerBox?.height ?? 0),
  );
  expect(
    (composerBox?.y ?? 0) + (composerBox?.height ?? 0),
  ).toBeLessThanOrEqual(viewportHeight);
  await page.screenshot({
    path: testInfo.outputPath("interface-polish-desktop-light.png"),
    fullPage: true,
  });

  await explore.focus();
  await page.keyboard.press("Tab");
  const improve = page.getByRole("button", { name: /Make it better/i });
  await expect(improve).toBeFocused();
  expect(
    await improve.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
  await page.keyboard.press("Enter");
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(
    "Review this project and suggest a focused improvement. Explain the tradeoffs before changing any files.",
  );
  await expect(
    page
      .locator("article")
      .getByText(/Review this project and suggest a focused improvement/),
  ).toHaveCount(0);

  await composer.fill("");
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
    path: testInfo.outputPath("interface-polish-desktop-dark.png"),
    fullPage: true,
  });

  const message = `INTERFACE_POLISH_${Date.now()}`;
  await composer.fill(message);
  await composer.press("Enter");
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(
    page.getByText(new RegExp(`E2E e2e-(primary|secondary): ${message}`)),
  ).toBeVisible();
});

test("keeps the refreshed login presentation bounded", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    colorScheme: "light",
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1280, height: 720 },
  });
  const visitor = await context.newPage();
  try {
    await visitor.goto("/");
    await expect(visitor.getByText("Your AI workspace")).toBeVisible();
    await expect(
      visitor.getByRole("button", { name: /Pocket ID/i }),
    ).toBeVisible();
    expect(
      await visitor.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await visitor.screenshot({
      path: testInfo.outputPath("interface-polish-login-light.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
