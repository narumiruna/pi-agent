import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  appOrigin,
  expectNoSeriousAccessibilityViolations,
} from "../support/test-helpers.js";

test("persists system instructions and manages user prompt templates", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Prompts" }).click();
  await expect(page).toHaveURL(/\/prompts$/);
  const systemContent = `E2E system instructions ${Date.now()}`;
  const system = page.getByRole("textbox", { name: "System prompt" });
  await system.fill(systemContent);
  const systemSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/documents/system") &&
      response.request().method() === "PUT",
  );
  await system
    .locator("xpath=ancestor::section[1]")
    .getByRole("button", { name: "Save changes" })
    .click();
  expect((await systemSaved).status()).toBe(200);
  await expect(
    page.getByText("Prompt document saved and Pi reloaded."),
  ).toBeVisible();
  await expect(
    readFile(resolve(".local/e2e/runtime/agent/SYSTEM.md"), "utf8"),
  ).resolves.toBe(systemContent);

  await page.reload();
  await expect(page).toHaveURL(/\/prompts$/);
  await expect(
    page.getByRole("textbox", { name: "System prompt" }),
  ).toHaveValue(systemContent);

  await page.getByRole("tab", { name: "Prompt templates" }).click();
  const panel = page.getByRole("tabpanel", { name: "Prompt templates" });
  const templateName = `e2e-template-${Date.now()}`;
  const templatePath = resolve(
    `.local/e2e/runtime/agent/prompts/${templateName}.md`,
  );
  await panel
    .getByRole("textbox", { name: "Template name" })
    .fill(templateName);
  const templateContent =
    "---\ndescription: Review the E2E result\nargument-hint: <PR>\n---\nReview the E2E result.";
  await panel
    .getByRole("textbox", { name: "Template content" })
    .fill(templateContent);
  await panel.getByRole("button", { name: "Save changes" }).click();
  await expect(
    panel.getByText(`/${templateName}`, { exact: true }),
  ).toBeVisible();
  await expect(readFile(templatePath, "utf8")).resolves.toBe(templateContent);
  await expect(
    panel.getByText(`~/.pi/agent/prompts/${templateName}.md`),
  ).toBeVisible();

  await page.getByRole("button", { name: "Chats" }).click();
  const composer = page.getByLabel("Ask Pi anything…");
  await composer.fill(`/${templateName}`);
  await expect(
    page.getByRole("option", { name: new RegExp(templateName) }),
  ).toBeVisible();
  await composer.press("Escape");
  await page.getByRole("button", { name: "Prompts" }).click();
  await page.getByRole("tab", { name: "Prompt templates" }).click();

  await panel
    .getByRole("button", { name: `Edit template ${templateName}` })
    .click();
  await expect(
    panel.getByRole("textbox", { name: "Template name" }),
  ).toBeDisabled();
  await panel
    .getByRole("textbox", { name: "Template content" })
    .fill("Updated E2E review.");
  const templateUpdated = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith("/api/prompts/prompt_") &&
      response.request().method() === "PUT",
  );
  await panel.getByRole("button", { name: "Save changes" }).click();
  expect((await templateUpdated).ok()).toBe(true);
  await expect(readFile(templatePath, "utf8")).resolves.toBe(
    "Updated E2E review.",
  );

  await panel
    .getByRole("button", { name: `Delete template ${templateName}` })
    .click();
  await expect(
    panel.getByText(`/${templateName}`, { exact: true }),
  ).toHaveCount(0);
  await expect(access(templatePath)).rejects.toMatchObject({ code: "ENOENT" });
  await page.getByRole("button", { name: "Chats" }).click();
  await page.getByLabel("Ask Pi anything…").fill(`/${templateName}`);
  await expect(
    page.getByRole("option", { name: new RegExp(templateName) }),
  ).toHaveCount(0);
});

test("shows native package prompts as read-only resources", async ({
  page,
}) => {
  const packageName = `prompt-package-${Date.now()}`;
  const packageRoot = resolve(`.local/e2e/runtime/${packageName}`);
  await mkdir(join(packageRoot, "prompts"), { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    `${JSON.stringify({ name: packageName, version: "1.0.0" })}\n`,
  );
  await writeFile(
    join(packageRoot, "prompts", "package-readonly.md"),
    "---\ndescription: Package read-only prompt\n---\nPackage body\n",
  );
  const installed = await page.request.post("/api/packages", {
    data: { source: packageRoot, acknowledgeRisk: true },
    headers: { origin: appOrigin },
  });
  expect(installed.ok()).toBe(true);
  const packages = await page.request.get("/api/packages");
  const item = (
    (await packages.json()) as Array<{ id: string; name: string }>
  ).find((candidate) => candidate.name.startsWith(`${packageName}-`));
  expect(item).toBeDefined();
  const packageLabel = item?.name;
  if (!packageLabel) throw new Error("Local package label was not projected");

  await page.goto("/prompts");
  await page.getByRole("tab", { name: "Prompt templates" }).click();
  const panel = page.getByRole("tabpanel", { name: "Prompt templates" });
  await expect(
    panel.getByText("/package-readonly", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("user package · Read-only")).toBeVisible();
  await expect(
    panel.getByText(`packages/${packageLabel}/prompts/package-readonly.md`),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Delete template package-readonly" }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "View template package-readonly" })
    .click();
  const packageContent = panel.getByRole("textbox", {
    name: "Template content",
  });
  await expect(packageContent).toHaveAttribute("readonly", "");
  await packageContent.focus();
  await expect(packageContent).toBeFocused();
  await expect(packageContent).toHaveValue("Package body");
  await expectNoSeriousAccessibilityViolations(page);

  const removed = await page.request.delete("/api/packages", {
    data: { id: item?.id, acknowledgeRisk: true },
    headers: { origin: appOrigin },
  });
  expect(removed.ok()).toBe(true);
  expect(await removed.json()).toEqual({ removed: true });
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/prompts");
      return ((await response.json()) as Array<{ name: string }>).map(
        (prompt) => prompt.name,
      );
    })
    .not.toContain("package-readonly");
  await rm(packageRoot, { force: true, recursive: true });
});

test("discovers and edits only trusted project prompt resources", async ({
  page,
}) => {
  const workspace = resolve(".local/e2e/runtime/workspace");
  const projectPrompts = join(workspace, ".pi", "prompts");
  const projectName = `project-prompt-${Date.now()}`;
  const projectPath = join(projectPrompts, `${projectName}.md`);
  await mkdir(projectPrompts, { recursive: true });
  await writeFile(
    projectPath,
    `---\ndescription: Trusted project prompt\n---\nProject body\n`,
  );
  const replacement = await page.request.post("/api/conversations", {
    headers: { origin: appOrigin },
  });
  expect(replacement.status()).toBe(201);

  const denied = await page.request.post("/api/prompts", {
    data: { name: "denied", content: "Denied", scope: "project" },
    headers: { origin: appOrigin },
  });
  expect(denied.status()).toBe(403);
  const beforeTrust = await page.request.get("/api/prompts");
  expect(
    ((await beforeTrust.json()) as Array<{ name: string }>).map(
      (prompt) => prompt.name,
    ),
  ).not.toContain(projectName);

  const trusted = await page.request.put("/api/project-trust", {
    data: { trusted: true, acknowledgeRisk: true },
    headers: { origin: appOrigin },
  });
  expect(trusted.ok()).toBe(true);
  await page.goto("/prompts");
  await page.getByRole("tab", { name: "Prompt templates" }).click();
  const panel = page.getByRole("tabpanel", { name: "Prompt templates" });
  await expect(
    panel.getByText(`/${projectName}`, { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText(`.pi/prompts/${projectName}.md`)).toBeVisible();
  await expect(panel.getByText("project · Editable")).toBeVisible();

  await panel
    .getByRole("button", { name: `Edit template ${projectName}` })
    .click();
  const projectContent = panel.getByRole("textbox", {
    name: "Template content",
  });
  await expect(projectContent).toHaveValue(
    "---\ndescription: Trusted project prompt\n---\nProject body\n",
  );
  await projectContent.fill(
    "---\ndescription: Updated trusted prompt\n---\nUpdated project body\n",
  );
  const projectUpdated = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith("/api/prompts/prompt_") &&
      response.request().method() === "PUT",
  );
  await panel.getByRole("button", { name: "Save changes" }).click();
  expect((await projectUpdated).ok()).toBe(true);
  await expect(readFile(projectPath, "utf8")).resolves.toContain(
    "Updated trusted prompt",
  );
  const commands = await page.request.get("/api/commands");
  expect(
    ((await commands.json()) as Array<{ name: string }>).map(
      (command) => command.name,
    ),
  ).toContain(projectName);

  const createdName = `project-created-${Date.now()}`;
  await panel.getByRole("combobox", { name: "Create in" }).click();
  await page.getByRole("option", { name: "Project prompts" }).click();
  await panel.getByRole("textbox", { name: "Template name" }).fill(createdName);
  await panel
    .getByRole("textbox", { name: "Template content" })
    .fill("Created in the trusted project");
  const projectCreated = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/prompts" &&
      response.request().method() === "POST",
  );
  await panel.getByRole("button", { name: "Save changes" }).click();
  expect((await projectCreated).status()).toBe(201);
  await expect(
    readFile(join(projectPrompts, `${createdName}.md`), "utf8"),
  ).resolves.toBe("Created in the trusted project");
  const projectDeleted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith("/api/prompts/prompt_") &&
      response.request().method() === "DELETE",
  );
  await panel
    .getByRole("button", { name: `Delete template ${createdName}` })
    .click();
  expect((await projectDeleted).status()).toBe(204);
  await expect(
    access(join(projectPrompts, `${createdName}.md`)),
  ).rejects.toMatchObject({ code: "ENOENT" });

  const disabled = await page.request.put("/api/project-trust", {
    data: { trusted: false, acknowledgeRisk: true },
    headers: { origin: appOrigin },
  });
  expect(disabled.ok()).toBe(true);
  await rm(join(workspace, ".pi"), { force: true, recursive: true });
});
