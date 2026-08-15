import { expect, type Page, test } from "@playwright/test";
import { appOrigin, mockOrigin } from "../../../e2e/support/test-helpers.js";

async function send(page: Page, message: string) {
  const composer = page.getByLabel("Ask Pi anything…");
  await expect(composer).toBeEnabled();
  await composer.fill(message);
  await composer.press("Enter");
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(
    page.getByText(new RegExp(`E2E e2e-(primary|secondary): ${message}`)),
  ).toBeVisible();
}

async function activeId(page: Page): Promise<string> {
  const response = await page.request.get("/api/conversations?sort=recent");
  expect(response.ok()).toBe(true);
  const conversations = (await response.json()) as Array<{
    id: string;
    active: boolean;
  }>;
  const active = conversations.find((conversation) => conversation.active);
  if (!active) throw new Error("Active conversation was not listed");
  return active.id;
}

test.beforeEach(async ({ request }) => {
  const reset = await request.post(`${mockOrigin}/__control/model/reset`);
  expect(reset.ok()).toBe(true);
});

test("renames, confirms deletion, and switches to a native fork", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).click();
  const marker = Date.now();
  const firstMessage = `MANAGE_FIRST_${marker}`;
  const firstName = `Managed ${marker}`;
  await send(page, firstMessage);
  const firstId = await activeId(page);

  await page
    .getByRole("button", { name: `Manage conversation ${firstId}` })
    .click();
  const management = page.getByRole("dialog", { name: "Manage conversation" });
  await expect(
    management.getByText(
      "Switch to another conversation before deleting this one.",
    ),
  ).toBeVisible();
  await expect(
    management.getByRole("button", { name: "Delete" }),
  ).toBeDisabled();
  const name = management.getByRole("textbox", { name: "Conversation name" });
  await name.fill(firstName);
  await management.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Conversation renamed.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: firstName, exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "New conversation" }).click();
  const secondMessage = `MANAGE_SECOND_${marker}`;
  await send(page, secondMessage);
  const secondId = await activeId(page);
  expect(secondId).not.toBe(firstId);

  await page
    .getByRole("button", { name: `Manage conversation ${firstName}` })
    .click();
  await management.getByRole("button", { name: "Delete" }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Delete conversation",
  });
  await expect(confirmation).toContainText(firstName);
  await confirmation.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Conversation deleted.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: firstName, exact: true }),
  ).toHaveCount(0);
  const afterDelete = await page.request.get("/api/conversations?sort=recent");
  expect(afterDelete.ok()).toBe(true);
  expect(
    ((await afterDelete.json()) as Array<{ id: string }>).map(
      (conversation) => conversation.id,
    ),
  ).not.toContain(firstId);

  const exported = await page.request.get(
    `/api/conversations/${secondId}/export/jsonl`,
  );
  expect(exported.ok()).toBe(true);
  const jsonl = await exported.text();
  const entries = jsonl
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; id?: string });
  expect(entries[0]).toMatchObject({ type: "session", id: secondId });

  await page.getByRole("button", { name: "Conversation details" }).click();
  const details = page.getByRole("dialog", { name: "Conversation details" });
  const userEntry = details
    .getByRole("treeitem")
    .filter({ hasText: secondMessage })
    .first();
  await userEntry.click();
  await expect(details.getByRole("button", { name: "Fork" })).toBeEnabled();
  await expect(details.getByRole("button", { name: "Clone" })).toBeEnabled();
  await details.getByRole("button", { name: "Fork" }).click();

  const forkedId = await activeId(page);
  expect(forkedId).not.toBe(secondId);
  await expect(page.getByLabel("Ask Pi anything…")).toHaveValue(secondMessage);
  await expect(
    page.locator("article").getByText(secondMessage, { exact: true }),
  ).toHaveCount(0);

  const cloneMessage = `MANAGE_CLONE_${marker}`;
  await send(page, cloneMessage);
  const cloneSourceId = await activeId(page);
  await page.getByRole("button", { name: "Conversation details" }).click();
  const cloneDetails = page.getByRole("dialog", {
    name: "Conversation details",
  });
  await cloneDetails.getByRole("treeitem").last().click();
  await cloneDetails.getByRole("button", { name: "Clone" }).click();

  const clonedId = await activeId(page);
  expect(clonedId).not.toBe(cloneSourceId);
  await expect(page.getByText(cloneMessage, { exact: true })).toBeVisible();
});

test("rejects management during a run and restores the native queue after reload", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New conversation" }).click();
  const message = `E2E_HOLD management isolation ${Date.now()}`;
  const composer = page.getByLabel("Ask Pi anything…");
  await composer.fill(message);
  await composer.press("Enter");
  await expect(page.locator("article.streaming")).toBeVisible();
  const id = await activeId(page);

  try {
    const mutationHeaders = {
      "content-type": "application/json",
      origin: appOrigin,
    };
    const [rename, deletion, fork, create] = await Promise.all([
      page.request.patch(`/api/conversations/${id}`, {
        data: { name: "blocked" },
        headers: { origin: appOrigin },
      }),
      page.request.delete(`/api/conversations/${id}`, {
        headers: { origin: appOrigin },
      }),
      page.request.post(`/api/conversations/${id}/fork`, {
        data: { targetId: "entry", position: "at" },
        headers: { origin: appOrigin },
      }),
      page.request.post("/api/conversations", {
        data: {},
        headers: mutationHeaders,
      }),
    ]);
    expect(rename.status()).toBe(409);
    expect(deletion.status()).toBe(409);
    expect(fork.status()).toBe(409);
    expect(create.status()).toBe(409);
    const activeRow = page
      .locator(".sidebar .conversationItem.active")
      .locator("..");
    await expect(activeRow.locator(".conversationManage")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Conversation details" }),
    ).toBeDisabled();

    await composer.fill("restore this queued guidance");
    await page.getByRole("button", { name: "Steer" }).click();
    await expect(
      page.getByRole("region", { name: "Queued messages" }),
    ).toContainText("restore this queued guidance");

    await page.reload();
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Queued messages" }),
    ).toContainText("restore this queued guidance");
    await page.getByRole("button", { name: "Restore to editor" }).click();
    await expect(page.getByLabel("Ask Pi anything…")).toHaveValue(
      "restore this queued guidance",
    );
  } finally {
    const release = await request.post(`${mockOrigin}/__control/release`);
    expect([200, 409]).toContain(release.status());
  }
  await expect(
    page.getByRole("button", { name: "New conversation" }),
  ).toBeEnabled();
});
