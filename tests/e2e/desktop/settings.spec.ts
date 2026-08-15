import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { appOrigin, mockOrigin } from "../support/test-helpers.js";

const workspace = resolve(".local/e2e/runtime/workspace");

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

interface ModelData {
  current: ModelOption;
  models: ModelOption[];
}

test("enables and disables project resources only with acknowledged trust", async ({
  page,
}) => {
  const extensionDirectory = join(workspace, ".pi", "extensions");
  const skillDirectory = join(workspace, ".pi", "skills", "project-e2e");
  await mkdir(extensionDirectory, { recursive: true });
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(extensionDirectory, "project-e2e.js"),
    'export default function (pi) { pi.registerCommand("project-e2e", { handler() {} }); }\n',
  );
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    "---\nname: project-e2e\ndescription: Project trust E2E skill\n---\nUse only after trust.\n",
  );
  const replacement = await page.request.post("/api/conversations", {
    headers: { origin: appOrigin },
  });
  expect(replacement.status()).toBe(201);

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();

  const commandNames = async () => {
    const response = await page.request.get("/api/commands");
    const commands = (await response.json()) as { name: string }[];
    return commands.map((command) => command.name);
  };
  expect(await commandNames()).not.toContain("project-e2e");
  expect(await commandNames()).not.toContain("skill:project-e2e");

  const enable = page.getByRole("button", { name: "Trust project resources" });
  await expect(enable).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: /extensions and packages can execute arbitrary code/i,
    })
    .check();
  await enable.click();
  await expect(
    page.getByText("Project resources are trusted and reloaded."),
  ).toBeVisible();
  expect(await commandNames()).toContain("project-e2e");
  expect(await commandNames()).toContain("skill:project-e2e");

  await rm(join(workspace, ".pi"), { force: true, recursive: true });
  await page.getByRole("button", { name: "Disable project resources" }).click();
  await expect(
    page.getByText("Project resources are disabled and reloaded."),
  ).toBeVisible();
  expect(await commandNames()).not.toContain("project-e2e");
  expect(await commandNames()).not.toContain("skill:project-e2e");
});

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
