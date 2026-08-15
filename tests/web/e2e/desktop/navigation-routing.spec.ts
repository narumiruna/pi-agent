import { expect, type Page as PlaywrightPage, test } from "@playwright/test";
import { CURRENT_APP_ROUTES, type Page } from "../../../../src/web/routes.js";

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
});
