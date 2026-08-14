import { expect, type Page, test } from "@playwright/test";
import { mockOrigin } from "../support/test-helpers.js";

test.beforeEach(async ({ request }) => {
  const reset = await request.post(`${mockOrigin}/__control/model/reset`);
  expect(reset.ok()).toBe(true);
});

async function send(page: Page, message: string) {
  const composer = page.getByLabel("Ask Pi anything…");
  await expect(composer).toBeEnabled();
  await composer.fill(message);
  await composer.press("Enter");
  await expect(page.getByText(message, { exact: true })).toBeVisible();
}

test("streams the first conversation and restores it after reload", async ({
  page,
  request,
}) => {
  await page.goto("/");

  const message = "E2E_HOLD first streamed message";
  await send(page, message);
  try {
    await expect(page.locator("article.streaming")).toContainText("E2E e2e-");
    await expect(
      page.getByRole("button", { name: "New conversation" }),
    ).toBeDisabled();
  } finally {
    const release = await request.post(`${mockOrigin}/__control/release`);
    expect([200, 409]).toContain(release.status());
  }
  await expect(
    page.getByText(new RegExp(`E2E e2e-(primary|secondary): ${message}`)),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New conversation" }),
  ).toBeEnabled();

  const captured = await request.get(`${mockOrigin}/__control/requests`);
  await expect(captured.json()).resolves.toMatchObject({
    requests: [
      {
        model: expect.stringMatching(/^e2e-(primary|secondary)$/),
        userMessage: message,
      },
    ],
  });

  await page.reload();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(
    page.getByText(new RegExp(`E2E e2e-(primary|secondary): ${message}`)),
  ).toBeVisible();
});

test("queues steering while a response is running", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const initial = `E2E_HOLD initial ${Date.now()}`;
  await send(page, initial);
  await expect(page.locator("article.streaming")).toBeVisible();

  const composer = page.getByLabel("Ask Pi anything…");
  await composer.fill("steering guidance");
  await page.getByRole("button", { name: "Steer" }).click();
  await expect(
    page.getByRole("region", { name: "Queued messages" }),
  ).toContainText("steering guidance");

  const release = await request.post(`${mockOrigin}/__control/release`);
  expect(release.ok()).toBe(true);
  await expect(
    page.getByText("steering guidance", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/E2E e2e-(primary|secondary): steering guidance/),
  ).toBeVisible();
});

test("keeps new and existing conversations isolated", async ({ page }) => {
  await page.goto("/");
  const oldMessage = `old conversation ${Date.now()}`;
  await send(page, oldMessage);
  await expect(
    page.getByText(new RegExp(`E2E e2e-(primary|secondary): ${oldMessage}`)),
  ).toBeVisible();

  const beforeResponse = await page.request.get("/api/conversations");
  const before = (await beforeResponse.json()) as Array<{
    id: string;
    active: boolean;
  }>;
  const oldConversation = before.find((conversation) => conversation.active);
  if (!oldConversation) throw new Error("Active conversation was not listed");

  await page.getByRole("button", { name: "New conversation" }).click();
  const newMessage = `new conversation ${Date.now()}`;
  await send(page, newMessage);
  await expect(
    page.getByText(new RegExp(`E2E e2e-(primary|secondary): ${newMessage}`)),
  ).toBeVisible();
  await expect(page.getByText(oldMessage, { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: oldConversation.id }).click();
  await expect(page.getByText(oldMessage, { exact: true })).toBeVisible();
  await expect(page.getByText(newMessage, { exact: true })).toHaveCount(0);
});

test("recovers after a provider request fails", async ({ page, request }) => {
  await page.goto("/");
  expect((await request.post(`${mockOrigin}/__control/fail-next`)).ok()).toBe(
    true,
  );

  await send(page, `planned failure ${Date.now()}`);
  const composer = page.getByLabel("Ask Pi anything…");
  await expect(composer).toBeEnabled();

  const retryMessage = `successful retry ${Date.now()}`;
  await send(page, retryMessage);
  await expect(
    page.getByText(new RegExp(`E2E e2e-(primary|secondary): ${retryMessage}`)),
  ).toBeVisible();
});
