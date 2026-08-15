import { expect, test } from "@playwright/test";

test("self-hosts Monaco languages and workers without external requests", async ({
  baseURL,
  page,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const appOrigin = new URL(baseURL).origin;
  const externalRequests: string[] = [];
  const workerRequests = new Set<string>();

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (url.origin !== appOrigin) externalRequests.push(url.href);
      if (url.pathname.includes(".worker-"))
        workerRequests.add(url.pathname.split("/").at(-1) ?? url.pathname);
    }
  });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("button", { name: "Files" }).click();

  await page.getByRole("button", { name: /src.*Directory/i }).click();
  await page.getByRole("button", { name: /existing\.ts/i }).click();
  await expect(page.locator(".monaco-editor.vs-dark")).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator(".monaco-editor.vs")).toBeVisible();
  await expect
    .poll(() => [...workerRequests], { timeout: 15_000 })
    .toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^editor\.worker-/),
        expect.stringMatching(/^ts\.worker-/),
      ]),
    );

  await page.getByRole("button", { name: "Workspace" }).click();
  await page.getByRole("button", { name: /workers.*Directory/i }).click();
  for (const [file, language, worker] of [
    ["config.json", "json", /^json\.worker-/],
    ["page.html", "html", /^html\.worker-/],
    ["style.css", "css", /^css\.worker-/],
  ] as const) {
    await page
      .getByRole("button", { name: new RegExp(file.replace(".", "\\.")) })
      .click();
    await expect(
      page.locator(
        `[data-editor-mode="monaco"][data-editor-language="${language}"]`,
      ),
    ).toBeVisible();
    await expect
      .poll(() => [...workerRequests], { timeout: 15_000 })
      .toEqual(expect.arrayContaining([expect.stringMatching(worker)]));
  }

  const styleEditor = page.getByRole("textbox", {
    name: "Contents of style.css",
  });
  const styleSurface = styleEditor.locator(
    "xpath=ancestor::div[contains(@class, 'monaco-editor')][1]",
  );
  await styleSurface.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("/* local draft */\n");

  await page.getByRole("button", { name: "Use plain editor" }).click();
  await expect(
    page.getByRole("textbox", { name: "Contents of style.css" }),
  ).toHaveValue(/local draft/);
  await expect(page.locator(".monaco-editor")).toHaveCount(0);
  await page.getByRole("button", { name: "Use code editor" }).click();
  await expect(page.locator(".monaco-editor")).toHaveCount(1);

  expect(externalRequests).toEqual([]);
});
