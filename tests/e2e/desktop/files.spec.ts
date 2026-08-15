import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { expectNoSeriousAccessibilityViolations } from "../support/test-helpers.js";

const workspace = resolve(".local/e2e/runtime/workspace");

function monacoSurface(page: Page, label: string) {
  return page
    .getByRole("textbox", { name: label })
    .locator("xpath=ancestor::div[contains(@class, 'monaco-editor')][1]");
}

async function replaceEditor(page: Page, label: string, value: string) {
  await monacoSurface(page, label).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(value);
}

test("browses and safely manages workspace files with Monaco", async ({
  page,
}) => {
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
  await expect(
    page.locator(
      '[data-editor-mode="monaco"][data-editor-language="typescript"]',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Contents of existing.ts" }),
  ).toHaveCount(1);
  await expect(monacoSurface(page, "Contents of existing.ts")).toBeVisible();

  await page.getByRole("button", { name: "Workspace" }).click();
  await page.getByRole("button", { name: "New file" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(createdName);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("File created.")).toBeVisible();
  await replaceEditor(page, `Contents of ${createdName}`, "saved in browser\n");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("File saved.")).toBeVisible();
  await expect(readFile(createdPath, "utf8")).resolves.toBe(
    "saved in browser\n",
  );

  await writeFile(createdPath, "changed outside\n");
  await replaceEditor(
    page,
    `Contents of ${createdName}`,
    "local unsaved draft\n",
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Review file changes" }),
  ).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await expect(
    page.getByRole("textbox", { name: "Latest disk version" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "Your editable draft" }),
  ).toHaveCount(1);
  await expect(monacoSurface(page, "Your editable draft")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("heading", { name: "Review file changes" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Review file changes" }),
  ).toBeVisible();
  await replaceEditor(page, "Your editable draft", "merged in browser\n");
  await page.getByRole("button", { name: "Apply merged draft" }).click();
  await expect(page.getByText("Merged draft is ready to save.")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("File saved.")).toBeVisible();
  await expect(readFile(createdPath, "utf8")).resolves.toBe(
    "merged in browser\n",
  );

  await page.getByRole("button", { name: "Editor settings" }).click();
  await page.getByRole("combobox", { name: "Font size" }).selectOption("18");
  await page.getByRole("button", { name: "Done" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("pi-agent-files-editor-v1") ?? "null"),
      ),
    )
    .toMatchObject({ fontSize: 18, mode: "monaco" });

  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(renamedName);
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByText("File renamed.")).toBeVisible();
  await expect(access(createdPath)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(renamedPath, "utf8")).resolves.toBe(
    "merged in browser\n",
  );

  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(renamedName);
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  await expect(readFile(downloadedPath as string, "utf8")).resolves.toBe(
    "merged in browser\n",
  );

  await page.reload();
  await page.getByRole("button", { name: "Files" }).click();
  await page.getByRole("button", { name: new RegExp(renamedName) }).click();
  await expect(page.locator('[data-editor-mode="monaco"]')).toBeVisible();
  await page.getByRole("button", { name: "Editor settings" }).click();
  await expect(page.getByRole("combobox", { name: "Font size" })).toHaveValue(
    "18",
  );
  await page.getByRole("button", { name: "Done" }).click();

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
