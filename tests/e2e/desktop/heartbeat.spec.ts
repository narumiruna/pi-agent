import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("persists HEARTBEAT.md and records a quiet manual run", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Heartbeat" }).click();
  const content = `---\nenabled: true\nevery: 7d\n---\n\nE2E_HEARTBEAT\n`;
  await page.getByLabel("HEARTBEAT.md").fill(content);

  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/documents/heartbeat") &&
      response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await saved).status()).toBe(200);
  await expect(
    readFile(resolve(".local/e2e/runtime/agent/HEARTBEAT.md"), "utf8"),
  ).resolves.toBe(content);

  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/heartbeat/run") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run now" }).click();
  expect((await completed).status()).toBe(200);
  await expect(page.getByText("Quiet", { exact: true })).toBeVisible();
  await expect(
    page.locator("span").getByText("HEARTBEAT_OK", { exact: true }),
  ).toBeVisible();
  await page.getByText("View details", { exact: true }).click();
  await expect(page.getByText("Full response", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Heartbeat" }).click();
  await expect(page.getByLabel("HEARTBEAT.md")).toHaveValue(content);
  await expect(page.getByText("Quiet", { exact: true })).toBeVisible();
  await expect(page.getByText("View details", { exact: true })).toBeVisible();
});
