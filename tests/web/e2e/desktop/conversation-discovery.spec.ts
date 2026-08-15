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

async function activeConversationId(page: Page): Promise<string> {
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

test("uses native search, named-only, and sort controls without changing a hidden active chat", async ({
  page,
}) => {
  await page.goto("/");
  const marker = Date.now();
  const alpha = `DISCOVERY_ALPHA_${marker} browser search message`;
  const beta = `DISCOVERY_BETA_${marker} persisted conversation`;
  const alphaName = `Named discovery ${marker}`;

  await send(page, alpha);
  const alphaId = await activeConversationId(page);
  const rename = await page.request.patch(`/api/conversations/${alphaId}`, {
    data: { name: alphaName },
    headers: { origin: appOrigin },
  });
  expect(rename.ok()).toBe(true);

  await page.getByRole("button", { name: "New conversation" }).click();
  await send(page, beta);
  const betaId = await activeConversationId(page);
  expect(betaId).not.toBe(alphaId);

  await page.getByRole("button", { name: "New conversation" }).click();
  const unpersistedId = await activeConversationId(page);
  expect([alphaId, betaId]).not.toContain(unpersistedId);
  await expect(page.getByText("Start with a clear request.")).toBeVisible();

  const apiSearch = await page.request.get(
    `/api/conversations?q=${encodeURIComponent(`DISCOVERY_ALPHA_${marker}`)}&sort=relevance`,
  );
  expect(apiSearch.ok()).toBe(true);
  const safeResults = (await apiSearch.json()) as Array<
    Record<string, unknown>
  >;
  expect(safeResults.map((result) => result.id)).toContain(alphaId);
  expect(JSON.stringify(safeResults)).not.toContain(alpha);
  expect(JSON.stringify(safeResults)).not.toContain("/sessions/");
  expect(JSON.stringify(safeResults)).not.toContain("allMessagesText");

  const discovery = page.getByRole("search", { name: "Find conversations" });
  const search = discovery.getByRole("searchbox", {
    name: "Search conversations",
  });
  await search.fill(`DISCOVERY_ALPHA_${marker}`);
  await expect(
    page.getByRole("button", { name: alphaName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: unpersistedId, exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Start with a clear request.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New conversation" }),
  ).toBeEnabled();

  await search.fill("");
  await expect(
    page.getByRole("button", { name: unpersistedId, exact: true }),
  ).toHaveClass(/active/);
  const nameFilter = discovery.getByRole("combobox", { name: "Name" });
  await nameFilter.selectOption("named");
  await expect(
    page.getByRole("button", { name: alphaName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: unpersistedId, exact: true }),
  ).toHaveCount(0);

  const sort = discovery.getByRole("combobox", { name: "Sort" });
  await sort.selectOption("recent");
  await expect(sort).toHaveValue("recent");
  await sort.selectOption("relevance");
  await expect(sort).toHaveValue("relevance");
  await sort.selectOption("threaded");
  await expect(sort).toHaveValue("threaded");

  await discovery.getByRole("button", { name: "Reset" }).click();
  await expect(nameFilter).toHaveValue("all");
  await expect(sort).toHaveValue("threaded");
  await page.getByRole("button", { name: alphaName, exact: true }).click();
  await expect(page.getByText(alpha, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: betaId, exact: true }).click();
  await expect(page.getByText(beta, { exact: true })).toBeVisible();
});
