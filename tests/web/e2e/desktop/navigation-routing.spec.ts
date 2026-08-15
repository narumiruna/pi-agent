import { expect, type Page as PlaywrightPage, test } from "@playwright/test";
import { CURRENT_APP_ROUTES, type Page } from "../../../../src/web/routes.js";
import {
  appOrigin,
  selectIdentity,
} from "../../../e2e/support/test-helpers.js";

function destinationContent(page: PlaywrightPage, destination: Page) {
  switch (destination) {
    case "chats":
      return page.getByRole("region", { name: "Chat" });
    case "files":
      return page.getByRole("heading", { name: "Files" });
    case "heartbeat":
      return page.getByRole("heading", { name: "Heartbeat" });
    case "library":
      return page.getByRole("heading", { name: "Library" });
    case "settings":
      return page.getByRole("heading", { name: "Settings" });
  }
}

test("restores canonical destinations and safely recovers invalid routes", async ({
  page,
}) => {
  for (const route of CURRENT_APP_ROUTES) {
    const response = await page.goto(route.path);
    expect(response?.status()).toBe(200);
    await expect(destinationContent(page, route.id)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${route.path}$`));

    await page.reload();
    await expect(destinationContent(page, route.id)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${route.path}$`));
  }

  await page.goto("/files?view=tree#editor");
  await expect(destinationContent(page, "files")).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/files\?view=tree#editor$/);

  for (const invalidPath of [
    "/",
    "/unknown",
    "/nested/unknown",
    "/files/",
    "/prompts",
    "/skills",
    "/extensions",
  ]) {
    const response = await page.goto(invalidPath);
    expect(response?.status()).toBe(200);
    await expect(destinationContent(page, "chats")).toBeVisible();
    await expect(page).toHaveURL(/\/chats$/);
  }

  const unknownApi = await page.request.get("/api/unknown", {
    headers: { accept: "text/html" },
  });
  expect(unknownApi.status()).toBe(404);
  const nonHtmlRoute = await page.request.get("/files", {
    headers: { accept: "application/json" },
  });
  expect(nonHtmlRoute.status()).toBe(404);
});

test("preserves a direct valid destination through OIDC sign-in", async ({
  browser,
  request,
}) => {
  await selectIdentity(request, "owner-1");
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const visitor = await context.newPage();
  try {
    await visitor.goto(`${appOrigin}/files`);
    await expect(
      visitor.getByRole("button", { name: /Pocket ID/i }),
    ).toBeVisible();
    await visitor.getByRole("button", { name: /Pocket ID/i }).click();
    await expect(visitor).toHaveURL(`${appOrigin}/files`);
    await expect(destinationContent(visitor, "files")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("syncs Back and Forward while protecting a dirty Files draft", async ({
  page,
}) => {
  await page.goto("/chats");
  await page.getByRole("button", { name: "Files" }).click();
  await expect(page).toHaveURL(/\/files$/);
  await page.goBack();
  await expect(destinationContent(page, "chats")).toBeVisible();
  await expect(page).toHaveURL(/\/chats$/);
  await page.goForward();
  await expect(destinationContent(page, "files")).toBeVisible();
  await expect(page).toHaveURL(/\/files$/);

  await page.getByRole("button", { name: /src.*Directory/i }).click();
  await page.getByRole("button", { name: /existing\.ts/i }).click();
  const editor = page.getByRole("textbox", {
    name: "Contents of existing.ts",
  });
  const editorSurface = editor.locator(
    "xpath=ancestor::div[contains(@class, 'monaco-editor')][1]",
  );
  await editorSurface.click();
  await page.keyboard.insertText(" unsaved route draft");
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeEnabled();
  expect(await page.evaluate(() => history.state?.piAgentRouteIndex)).toBe(1);

  await page.goBack();
  await expect(page.getByText("Discard unsaved changes?")).toBeVisible();
  await expect(page).toHaveURL(/\/files$/);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeEnabled();

  await page.goBack();
  await expect(page.getByText("Discard unsaved changes?")).toBeVisible();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(destinationContent(page, "chats")).toBeVisible();
  await expect(page).toHaveURL(/\/chats$/);
  expect(await page.evaluate(() => history.state?.piAgentRouteIndex)).toBe(0);

  await page.goForward();
  await expect(destinationContent(page, "files")).toBeVisible();
  await expect(page).toHaveURL(/\/files$/);
  await page.goBack();
  await expect(destinationContent(page, "chats")).toBeVisible();
  await expect(page).toHaveURL(/\/chats$/);

  await page.goForward();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.goBack();
  await expect(destinationContent(page, "files")).toBeVisible();
  await page.getByRole("button", { name: /src.*Directory/i }).click();
  await page.getByRole("button", { name: /existing\.ts/i }).click();
  const forwardEditor = page.getByRole("textbox", {
    name: "Contents of existing.ts",
  });
  await forwardEditor
    .locator("xpath=ancestor::div[contains(@class, 'monaco-editor')][1]")
    .click();
  await page.keyboard.insertText(" unsaved forward draft");
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeEnabled();

  await page.goForward();
  await expect(page.getByText("Discard unsaved changes?")).toBeVisible();
  await expect(page).toHaveURL(/\/files$/);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.goForward();
  await expect(page.getByText("Discard unsaved changes?")).toBeVisible();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(destinationContent(page, "settings")).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  expect(await page.evaluate(() => history.state?.piAgentRouteIndex)).toBe(2);
  await page.goBack();
  await expect(destinationContent(page, "files")).toBeVisible();
  await expect(page).toHaveURL(/\/files$/);
});
