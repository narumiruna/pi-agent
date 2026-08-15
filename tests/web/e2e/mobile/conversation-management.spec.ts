import { expect, type Page, test } from "@playwright/test";
import { expectNoSeriousAccessibilityViolations } from "../../../e2e/support/test-helpers.js";

async function send(page: Page, message: string) {
  const composer = page.getByLabel("Ask Pi anything…");
  await expect(composer).toBeEnabled();
  await composer.fill(message);
  await composer.press("Enter");
  await expect(
    page.getByText(new RegExp(`E2E e2e-(primary|secondary): ${message}`)),
  ).toBeVisible();
}

async function activeId(page: Page): Promise<string> {
  const response = await page.request.get("/api/conversations?sort=recent");
  const conversations = (await response.json()) as Array<{
    id: string;
    active: boolean;
  }>;
  const active = conversations.find((conversation) => conversation.active);
  if (!active) throw new Error("Active conversation was not listed");
  return active.id;
}

async function openDrawer(page: Page) {
  await page.getByRole("button", { name: "Open navigation" }).click();
  return page.getByRole("dialog", { name: "Open navigation" });
}

test("manages and forks native conversations at 390px", async ({ page }) => {
  await page.goto("/");
  let drawer = await openDrawer(page);
  await drawer.getByRole("button", { name: "New conversation" }).click();
  const marker = Date.now();
  const oldMessage = `MOBILE_MANAGE_OLD_${marker}`;
  const oldName = `Mobile managed ${marker}`;
  await send(page, oldMessage);
  const oldId = await activeId(page);

  drawer = await openDrawer(page);
  await drawer
    .getByRole("button", { name: `Manage conversation ${oldId}` })
    .click();
  const management = page.getByRole("dialog", { name: "Manage conversation" });
  await expectNoSeriousAccessibilityViolations(page);
  const name = management.getByRole("textbox", { name: "Conversation name" });
  await name.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(oldName);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Conversation renamed.")).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.getByRole("button", { name: "Close" }).click();

  drawer = await openDrawer(page);
  await drawer.getByRole("button", { name: "New conversation" }).click();
  const currentMessage = `MOBILE_MANAGE_CURRENT_${marker}`;
  await send(page, currentMessage);
  const currentId = await activeId(page);
  expect(currentId).not.toBe(oldId);

  drawer = await openDrawer(page);
  await drawer
    .getByRole("button", { name: `Manage conversation ${oldName}` })
    .click();
  await management.getByRole("button", { name: "Delete" }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Delete conversation",
  });
  await expectNoSeriousAccessibilityViolations(page);
  await confirmation.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Conversation deleted.")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Conversation details" }).click();
  const details = page.getByRole("dialog", { name: "Conversation details" });
  await expect(
    details.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).resolves.toBe(true);
  await details
    .getByRole("treeitem")
    .filter({ hasText: currentMessage })
    .first()
    .click();
  await details.getByRole("button", { name: "Fork" }).click();

  expect(await activeId(page)).not.toBe(currentId);
  await expect(page.getByLabel("Ask Pi anything…")).toHaveValue(currentMessage);
  await expectNoSeriousAccessibilityViolations(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
