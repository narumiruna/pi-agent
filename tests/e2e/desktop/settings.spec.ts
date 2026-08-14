import { expect, test } from "@playwright/test";
import { mockOrigin } from "../support/test-helpers.js";

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

interface ModelData {
  current: ModelOption;
  models: ModelOption[];
}

test("cancels and applies a full-row model selection", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();

  const initialResponse = await page.request.get("/api/models");
  const initial = (await initialResponse.json()) as ModelData;
  const target = initial.models.find(
    (model) =>
      model.provider !== initial.current.provider ||
      model.id !== initial.current.id,
  );
  expect(target).toBeDefined();

  await page.getByRole("button", { name: "Change model" }).click();
  const apply = page.getByRole("button", { name: "Use this model" });
  await page.getByText(target?.name as string, { exact: true }).click();
  await expect(apply).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a model" }),
  ).toHaveCount(0);

  const afterCancel = (await (
    await page.request.get("/api/models")
  ).json()) as ModelData;
  expect(afterCancel.current).toMatchObject({
    provider: initial.current.provider,
    id: initial.current.id,
  });

  await page.getByRole("button", { name: "Change model" }).click();
  await page.getByText(target?.name as string, { exact: true }).click();
  await page.getByRole("button", { name: "Use this model" }).click();
  await expect(
    page.getByText(`${target?.name} is now used by chat and heartbeat.`),
  ).toBeVisible();
  await expect(
    page.getByText(target?.name as string, { exact: true }),
  ).toBeVisible();

  await request.delete(`${mockOrigin}/__control/requests`);
  await page.getByRole("button", { name: "Chat" }).click();
  const message = `selected model ${Date.now()}`;
  const composer = page.getByLabel("Ask Pi anything…");
  await composer.fill(message);
  await composer.press("Enter");
  await expect(
    page.getByText(`E2E ${target?.id}: ${message}`, { exact: true }),
  ).toBeVisible();

  const captured = await request.get(`${mockOrigin}/__control/requests`);
  await expect(captured.json()).resolves.toMatchObject({
    requests: [{ model: target?.id, userMessage: message }],
  });
});
