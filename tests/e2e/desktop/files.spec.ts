import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const workspace = resolve(".local/e2e/runtime/workspace");

test("browses and safely manages workspace files", async ({ page }) => {
  const suffix = String(Date.now());
  const createdName = `e2e-${suffix}.txt`;
  const renamedName = `e2e-renamed-${suffix}.txt`;
  const createdPath = resolve(workspace, createdName);
  const renamedPath = resolve(workspace, renamedName);

  await page.goto("/");
  await page.getByRole("button", { name: "Files" }).click();
  await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  await expect(page.getByText(".env", { exact: true })).toHaveCount(0);
  await expect(page.getByText(".git", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /src.*Directory/i }).click();
  await page.getByRole("button", { name: /existing\.ts/i }).click();
  await expect(page.getByLabel("Contents of existing.ts")).toHaveValue(
    "export const value = 1;\n",
  );

  await page.getByRole("button", { name: "Workspace" }).click();
  await page.getByRole("button", { name: "New file" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(createdName);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("File created.")).toBeVisible();
  const editor = page.getByLabel(`Contents of ${createdName}`);
  await editor.fill("saved in browser\n");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("File saved.")).toBeVisible();
  await expect(readFile(createdPath, "utf8")).resolves.toBe(
    "saved in browser\n",
  );

  await writeFile(createdPath, "changed outside\n");
  await editor.fill("local unsaved draft\n");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/changed on disk/i)).toBeVisible();
  await expect(editor).toHaveValue("local unsaved draft\n");
  await page.getByRole("button", { name: "Reload from disk" }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByLabel(`Contents of ${createdName}`)).toHaveValue(
    "changed outside\n",
  );

  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(renamedName);
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByText("File renamed.")).toBeVisible();
  await expect(access(createdPath)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(renamedPath, "utf8")).resolves.toBe(
    "changed outside\n",
  );

  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(renamedName);
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  await expect(readFile(downloadedPath as string, "utf8")).resolves.toBe(
    "changed outside\n",
  );

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(/permanently deleted/i)).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("File deleted.")).toBeVisible();
  await expect(access(renamedPath)).rejects.toMatchObject({ code: "ENOENT" });

  await page.getByRole("button", { name: /binary\.dat/i }).click();
  await expect(
    page.getByText("This file cannot be shown as text."),
  ).toBeVisible();
  await expect(page.getByLabel("Contents of binary.dat")).toHaveCount(0);

  await page.getByRole("button", { name: /large-preview\.txt/i }).click();
  await expect(
    page.getByText("This file is too large to preview."),
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "Search workspace files" })
    .fill("env");
  await expect(page.getByText("No matching files.")).toBeVisible();
});
