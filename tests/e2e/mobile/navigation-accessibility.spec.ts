import { expect, test } from "@playwright/test";
import { PRIMARY_NAVIGATION_ITEMS } from "../../../src/web/navigation.js";
import { expectNoSeriousAccessibilityViolations } from "../support/test-helpers.js";

function durationInMilliseconds(value: string): number {
  const duration = Number.parseFloat(value);
  return value.endsWith("ms") ? duration : duration * 1_000;
}

test("keyboard-operates every drawer destination with visible focus and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const menu = page.locator(".mobileMenu");
  await expect(menu).toHaveAttribute("aria-label", "Open navigation");
  const destinations = [
    {
      page: "chats",
      label: "Chat",
      content: () => page.getByRole("region", { name: "Chat" }),
    },
    {
      page: "files",
      label: "Files",
      content: () => page.getByRole("heading", { name: "Files" }),
    },
    {
      page: "library",
      label: "Library",
      content: () => page.getByRole("heading", { name: "Library" }),
    },
    {
      page: "settings",
      label: "Settings",
      content: () => page.getByRole("heading", { name: "Settings" }),
    },
    {
      page: "heartbeat",
      label: "Heartbeat",
      content: () => page.getByRole("heading", { name: "Heartbeat" }),
    },
  ];
  expect(destinations.map(({ page: id }) => id).sort()).toEqual(
    PRIMARY_NAVIGATION_ITEMS.map(({ page: id }) => id).sort(),
  );

  for (const destination of destinations) {
    await menu.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Open navigation" });
    await expect(dialog).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(document.activeElement?.closest('[role="dialog"]')),
        ),
      )
      .toBe(true);

    const navigation = dialog.getByRole("navigation", {
      name: "Primary navigation",
    });
    const control = navigation.getByRole("button", {
      name: destination.label,
    });
    await control.focus();
    await expect(control).toBeFocused();
    expect(
      await control.evaluate((element) => element.matches(":focus-visible")),
    ).toBe(true);
    const focusStyle = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: style.outlineWidth };
    });
    expect(focusStyle.style).not.toBe("none");
    expect(Number.parseFloat(focusStyle.width)).toBeGreaterThanOrEqual(2);

    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(menu).toBeFocused();
    await expect(destination.content()).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
  }

  await menu.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Open navigation" });
  const heartbeat = dialog
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: "Heartbeat" });
  await expect(heartbeat).toHaveAttribute("aria-current", "page");
  const timing = await heartbeat.locator(".pulseRail").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationDuration: style.animationDuration,
      transitionDelay: style.transitionDelay,
      transitionDuration: style.transitionDuration,
    };
  });
  expect(durationInMilliseconds(timing.animationDuration)).toBeLessThanOrEqual(
    0.001,
  );
  expect(durationInMilliseconds(timing.transitionDuration)).toBeLessThanOrEqual(
    0.001,
  );
  expect(durationInMilliseconds(timing.transitionDelay)).toBe(0);
  await expectNoSeriousAccessibilityViolations(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
