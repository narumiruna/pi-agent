import { constants } from "node:fs";
import {
  access,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  DefaultResourceLoader,
  type PromptTemplate,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PiService } from "../../src/server/agent/pi-service.js";
import { atomicWrite } from "../../src/server/resources/atomic-write.js";
import {
  noFollowReadFlags,
  ResourceConflictError,
  ResourcePermissionError,
  ResourceService,
} from "../../src/server/resources/service.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function setup() {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-agent-resources-"));
  const workspace = await mkdtemp(join(tmpdir(), "pi-agent-workspace-"));
  directories.push(agentDir, workspace);
  const reload = vi.fn(async () => undefined);
  const packages = {
    listConfiguredPackages: vi.fn(
      (): Array<{
        source: string;
        scope: "project" | "user";
        filtered: boolean;
        installedPath?: string;
      }> => [],
    ),
    installAndPersist: vi.fn(async () => undefined),
    removeAndPersist: vi.fn(async () => true),
    update: vi.fn(async () => undefined),
  };
  const runtime = {
    reload,
    mutateResources: async <T>(operation: () => Promise<T>): Promise<T> => {
      await reload();
      const result = await operation();
      await reload();
      return result;
    },
    projectTrust: vi.fn(() => ({ required: false, trusted: false })),
    promptDiagnostics: vi.fn(() => []),
    promptTemplates: vi.fn(() => []),
  };
  return {
    agentDir,
    workspace,
    reload,
    runtime,
    packages,
    service: new ResourceService(
      agentDir,
      workspace,
      packages as never,
      runtime,
    ),
  };
}

describe("ResourceService", () => {
  test("preserves an existing file when atomic replacement validation fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-agent-atomic-update-"));
    directories.push(directory);
    const path = join(directory, "prompt.md");
    await writeFile(path, "Original\n");
    const stat = await lstat(path);

    await expect(
      atomicWrite(path, "Replacement\n", 0o600, directory, {
        dev: stat.dev,
        ino: stat.ino,
        birthtimeMs: stat.birthtimeMs + 1,
        ctimeMs: stat.ctimeMs,
        size: stat.size,
      }),
    ).rejects.toThrow(/changed/i);

    expect(await readFile(path, "utf8")).toBe("Original\n");
  });

  test("falls back to read-only flags when no-follow is unavailable", () => {
    expect(noFollowReadFlags(undefined)).toBe(constants.O_RDONLY);
  });

  test("securely reads regular files without a no-follow open flag", async () => {
    const { agentDir, workspace, packages, runtime } = await setup();
    const promptPath = join(agentDir, "prompts", "fallback.md");
    const targetPath = join(agentDir, "outside-fallback.md");
    const linkPath = join(agentDir, "prompts", "linked-fallback.md");
    await mkdir(dirname(promptPath), { recursive: true });
    await writeFile(join(agentDir, "SYSTEM.md"), "Fallback system\n");
    await writeFile(promptPath, "Fallback prompt\n");
    await writeFile(targetPath, "Fallback filesystem secret\n");
    await symlink(targetPath, linkPath);
    runtime.promptTemplates.mockReturnValue([
      {
        name: "fallback",
        description: "Fallback prompt",
        content: "Fallback prompt\n",
        filePath: promptPath,
        sourceInfo: {
          path: promptPath,
          source: "local",
          scope: "user",
          origin: "top-level",
        },
      },
      {
        name: "linked-fallback",
        description: "Fallback filesystem secret",
        content: "Fallback filesystem secret\n",
        filePath: linkPath,
        sourceInfo: {
          path: linkPath,
          source: "local",
          scope: "user",
          origin: "top-level",
        },
      },
    ]);
    const service = new ResourceService(
      agentDir,
      workspace,
      packages as never,
      runtime,
      null,
    );

    await expect(service.readDocument("system")).resolves.toBe(
      "Fallback system\n",
    );
    await expect(service.listPromptResources()).resolves.toEqual([
      expect.objectContaining({
        name: "fallback",
        content: "Fallback prompt\n",
        editable: true,
      }),
      expect.objectContaining({
        name: "linked-fallback",
        description: "",
        content: "",
        editable: false,
      }),
    ]);
  });

  test("projects Pi's native prompt inventory without private source metadata", async () => {
    const { agentDir, workspace, runtime, service } = await setup();
    const userPath = join(agentDir, "prompts", "user-review.md");
    const projectPath = join(workspace, ".pi", "prompts", "project-review.md");
    const outsidePath = join(agentDir, "configured", "settings-review.md");
    const nestedPath = join(agentDir, "prompts", "nested", "nested-review.md");
    const packageBase = join(agentDir, "cache", "repository");
    const packagePath = join(packageBase, "prompts", "package-review.md");
    const temporaryPath = join(agentDir, "cli", "temporary-review.md");
    const extensionPath = join(agentDir, "extension", "extension-review.md");
    const symlinkPath = join(agentDir, "prompts", "linked-review.md");
    await Promise.all([
      mkdir(join(agentDir, "prompts"), { recursive: true }),
      mkdir(join(workspace, ".pi", "prompts"), { recursive: true }),
      mkdir(join(agentDir, "configured"), { recursive: true }),
      mkdir(resolve(nestedPath, ".."), { recursive: true }),
      mkdir(dirname(packagePath), { recursive: true }),
      mkdir(dirname(temporaryPath), { recursive: true }),
      mkdir(dirname(extensionPath), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        userPath,
        "---\ndescription: User review\nargument-hint: <PR>\n---\nUser body\n",
      ),
      writeFile(projectPath, "Project raw body\n"),
      writeFile(outsidePath, "settings-review parsed body"),
      writeFile(nestedPath, "nested-review parsed body"),
      writeFile(packagePath, "package-review parsed body"),
      writeFile(temporaryPath, "temporary-review parsed body"),
      writeFile(extensionPath, "extension-review parsed body"),
      symlink(outsidePath, symlinkPath),
    ]);
    const prompt = (
      name: string,
      filePath: string,
      scope: "project" | "temporary" | "user",
      origin: "package" | "top-level",
      source: string,
      baseDir?: string,
    ): PromptTemplate => ({
      name,
      description:
        name === "user-review"
          ? "Use /review before merge"
          : `${name} description`,
      ...(name === "user-review" ? { argumentHint: "/review <PR>" } : {}),
      content: `${name} parsed body`,
      filePath,
      sourceInfo: { path: filePath, scope, origin, source, baseDir },
    });
    runtime.projectTrust.mockReturnValue({ required: true, trusted: true });
    runtime.promptTemplates.mockReturnValue([
      prompt("user-review", userPath, "user", "top-level", "local"),
      prompt("project-review", projectPath, "project", "top-level", "local"),
      prompt(
        "package-review",
        packagePath,
        "user",
        "package",
        "https://secret@example.com/org/repository.git?token=private",
        packageBase,
      ),
      prompt(
        "temporary-review",
        temporaryPath,
        "temporary",
        "top-level",
        "local",
      ),
      prompt(
        "extension-review",
        extensionPath,
        "temporary",
        "top-level",
        "extension:review-tools",
      ),
      prompt("settings-review", outsidePath, "user", "top-level", "local"),
      prompt("nested-review", nestedPath, "user", "top-level", "local"),
      prompt("linked-review", symlinkPath, "user", "top-level", "local"),
    ]);

    const resources = await service.listPromptResources();

    expect(resources).toEqual([
      expect.objectContaining({
        name: "user-review",
        description: "Use /review before merge",
        argumentHint: "/review <PR>",
        content: expect.stringContaining("description: User review"),
        path: "~/.pi/agent/prompts/user-review.md",
        source: "local",
        provenance: { scope: "user", origin: "top-level" },
        editable: true,
      }),
      expect.objectContaining({
        name: "project-review",
        content: "Project raw body\n",
        path: ".pi/prompts/project-review.md",
        provenance: { scope: "project", origin: "top-level" },
        editable: true,
      }),
      expect.objectContaining({
        name: "package-review",
        content: "package-review parsed body",
        path: "packages/example.com/org/repository/prompts/package-review.md",
        source: "example.com/org/repository",
        provenance: { scope: "user", origin: "package" },
        editable: false,
      }),
      expect.objectContaining({
        name: "temporary-review",
        path: "temporary/temporary-review.md",
        source: "CLI",
        editable: false,
      }),
      expect.objectContaining({
        name: "extension-review",
        path: "temporary/extension-review.md",
        source: "extension:review-tools",
        editable: false,
      }),
      expect.objectContaining({
        name: "settings-review",
        content: "settings-review parsed body",
        path: "settings/settings-review.md",
        source: "settings",
        editable: false,
      }),
      expect.objectContaining({
        name: "nested-review",
        content: "nested-review parsed body",
        path: "settings/nested-review.md",
        editable: false,
      }),
      expect.objectContaining({
        name: "linked-review",
        path: "~/.pi/agent/prompts/linked-review.md",
        editable: false,
      }),
    ]);
    expect(JSON.stringify(resources)).not.toMatch(
      /\/private|secret|token|baseDir|filePath|sourceInfo/,
    );
  });

  test("projects Pi's real additional prompt metadata as temporary", async () => {
    const { agentDir, workspace, packages } = await setup();
    const path = join(agentDir, "additional", "cli-review.md");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "CLI review\n");
    const settings = SettingsManager.create(workspace, agentDir, {
      projectTrusted: false,
    });
    const loader = new DefaultResourceLoader({
      cwd: workspace,
      agentDir,
      settingsManager: settings,
      additionalPromptTemplatePaths: [path],
    });
    await loader.reload();
    const [nativePrompt] = loader.getPrompts().prompts;
    expect(nativePrompt?.sourceInfo).toEqual(
      expect.objectContaining({
        source: "local",
        scope: "temporary",
        origin: "top-level",
      }),
    );
    const runtime = {
      reload: async () => loader.reload(),
      mutateResources: async <T>(operation: () => Promise<T>) => operation(),
      projectTrust: () => ({ required: false, trusted: false }),
      promptDiagnostics: () => loader.getPrompts().diagnostics,
      promptTemplates: () => loader.getPrompts().prompts,
    };
    const service = new ResourceService(
      agentDir,
      workspace,
      packages as never,
      runtime,
    );

    await expect(service.listPromptResources()).resolves.toEqual([
      expect.objectContaining({
        name: "cli-review",
        source: "CLI",
        path: "temporary/cli-review.md",
        editable: false,
        provenance: { scope: "temporary", origin: "top-level" },
      }),
    ]);
  });

  test("does not expose a canonical symlink target loaded by Pi", async () => {
    const { agentDir, workspace, packages } = await setup();
    const target = join(agentDir, "outside-secret.md");
    const link = join(agentDir, "prompts", "linked-secret.md");
    await mkdir(dirname(link), { recursive: true });
    await writeFile(target, "Filesystem secret loaded by Pi\n");
    await symlink(target, link);
    const settings = SettingsManager.create(workspace, agentDir, {
      projectTrusted: false,
    });
    const loader = new DefaultResourceLoader({
      cwd: workspace,
      agentDir,
      settingsManager: settings,
    });
    await loader.reload();
    expect(loader.getPrompts().prompts[0]?.content).toContain(
      "Filesystem secret loaded by Pi",
    );
    const runtime = {
      reload: async () => loader.reload(),
      mutateResources: async <T>(operation: () => Promise<T>) => operation(),
      projectTrust: () => ({ required: false, trusted: false }),
      promptDiagnostics: () => loader.getPrompts().diagnostics,
      promptTemplates: () => loader.getPrompts().prompts,
    };
    const service = new ResourceService(
      agentDir,
      workspace,
      packages as never,
      runtime,
    );

    await expect(service.listPromptResources()).resolves.toEqual([
      expect.objectContaining({
        name: "linked-secret",
        description: "",
        content: "",
        editable: false,
        deletable: false,
      }),
    ]);
    const resources = await service.listPromptResources();
    expect(JSON.stringify(resources)).not.toContain("Filesystem secret");
    const pi = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(pi, {
      config: { value: { agentDir, workspace } },
      runtime: {
        value: {
          session: {
            extensionRunner: { getRegisteredCommands: () => [] },
            promptTemplates: loader.getPrompts().prompts,
          },
          services: {
            resourceLoader: { getSkills: () => ({ skills: [] }) },
          },
        },
      },
    });
    const commands = pi.commands(resources);
    expect(commands).toEqual([
      expect.objectContaining({ name: "linked-secret", source: "prompt" }),
    ]);
    expect(JSON.stringify(commands)).not.toContain("Filesystem secret");
  });

  test("does not expose non-canonical symlink targets or command metadata", async () => {
    const { agentDir, workspace, runtime, service } = await setup();
    const target = join(agentDir, "outside-noncanonical-secret.md");
    await writeFile(target, "Non-canonical filesystem secret\n");
    const definitions = [
      {
        name: "settings-link",
        path: join(agentDir, "configured", "settings-link.md"),
        scope: "user" as const,
        origin: "top-level" as const,
        source: "local",
      },
      {
        name: "package-link",
        path: join(agentDir, "packages", "example", "package-link.md"),
        scope: "user" as const,
        origin: "package" as const,
        source: "example-package",
      },
      {
        name: "temporary-link",
        path: join(agentDir, "temporary", "temporary-link.md"),
        scope: "temporary" as const,
        origin: "top-level" as const,
        source: "cli",
      },
    ];
    for (const definition of definitions) {
      await mkdir(dirname(definition.path), { recursive: true });
      await symlink(target, definition.path);
    }
    const prompts = definitions.map(
      (definition): PromptTemplate => ({
        name: definition.name,
        description: "Non-canonical filesystem secret",
        content: "Non-canonical filesystem secret\n",
        filePath: definition.path,
        sourceInfo: {
          path: definition.path,
          source: definition.source,
          scope: definition.scope,
          origin: definition.origin,
          baseDir: dirname(definition.path),
        },
      }),
    );
    runtime.promptTemplates.mockReturnValue(prompts);

    const resources = await service.listPromptResources();

    expect(resources).toHaveLength(3);
    for (const resource of resources) {
      expect(resource).toEqual(
        expect.objectContaining({
          description: "",
          content: "",
          editable: false,
          deletable: false,
        }),
      );
    }
    const pi = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(pi, {
      config: { value: { agentDir, workspace } },
      runtime: {
        value: {
          session: {
            extensionRunner: { getRegisteredCommands: () => [] },
            promptTemplates: prompts,
          },
          services: {
            resourceLoader: { getSkills: () => ({ skills: [] }) },
          },
        },
      },
    });
    expect(JSON.stringify(pi.commands(resources))).not.toContain(
      "Non-canonical filesystem secret",
    );
  });

  test("does not trust a symlinked non-canonical source boundary", async () => {
    const { agentDir, runtime, service } = await setup();
    const realBoundary = join(agentDir, "outside-boundary");
    const linkedBoundary = join(agentDir, "configured-boundary");
    const realPath = join(realBoundary, "boundary-secret.md");
    const linkedPath = join(linkedBoundary, "boundary-secret.md");
    await mkdir(realBoundary, { recursive: true });
    await writeFile(realPath, "Boundary filesystem secret\n");
    await symlink(realBoundary, linkedBoundary);
    runtime.promptTemplates.mockReturnValue([
      {
        name: "boundary-secret",
        description: "Boundary filesystem secret",
        content: "Boundary filesystem secret\n",
        filePath: linkedPath,
        sourceInfo: {
          path: linkedPath,
          source: "local",
          scope: "user",
          origin: "top-level",
          baseDir: linkedBoundary,
        },
      },
    ]);

    await expect(service.listPromptResources()).resolves.toEqual([
      expect.objectContaining({ description: "", content: "" }),
    ]);
  });

  test("does not expose an external source through a symlinked ancestor", async () => {
    const { agentDir, workspace, runtime, service } = await setup();
    const container = await mkdtemp(
      join(tmpdir(), "pi-agent-prompt-ancestor-"),
    );
    directories.push(container);
    const realAncestor = join(container, "real-ancestor");
    const linkedAncestor = join(container, "linked-ancestor");
    const realBoundary = join(realAncestor, "source");
    const linkedBoundary = join(linkedAncestor, "source");
    const linkedPath = join(linkedBoundary, "ancestor-secret.md");
    await mkdir(realBoundary, { recursive: true });
    await writeFile(
      join(realBoundary, "ancestor-secret.md"),
      "Ancestor filesystem secret\n",
    );
    await symlink(realAncestor, linkedAncestor);
    const prompts: PromptTemplate[] = [
      {
        name: "ancestor-secret",
        description: "Ancestor filesystem secret",
        content: "Ancestor filesystem secret\n",
        filePath: linkedPath,
        sourceInfo: {
          path: linkedPath,
          source: "local",
          scope: "temporary",
          origin: "top-level",
          baseDir: linkedBoundary,
        },
      },
    ];
    runtime.promptTemplates.mockReturnValue(prompts);

    const resources = await service.listPromptResources();

    expect(resources).toEqual([
      expect.objectContaining({ description: "", content: "" }),
    ]);
    const pi = Object.create(PiService.prototype) as PiService;
    Object.defineProperties(pi, {
      config: { value: { agentDir, workspace } },
      runtime: {
        value: {
          session: {
            extensionRunner: { getRegisteredCommands: () => [] },
            promptTemplates: prompts,
          },
          services: {
            resourceLoader: { getSkills: () => ({ skills: [] }) },
          },
        },
      },
    });
    expect(JSON.stringify(pi.commands(resources))).not.toContain(
      "Ancestor filesystem secret",
    );
  });

  test("ignores non-string prompt frontmatter metadata", async () => {
    const { agentDir, runtime, service } = await setup();
    const path = join(agentDir, "configured", "typed-frontmatter.md");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      "---\ndescription:\n  - not\n  - text\nargument-hint:\n  - also\n  - not-text\n---\nBody fallback\n",
    );
    runtime.promptTemplates.mockReturnValue([
      {
        name: "typed-frontmatter",
        description: ["not", "text"] as never,
        argumentHint: ["also", "not-text"] as never,
        content: "Body fallback\n",
        filePath: path,
        sourceInfo: {
          path,
          source: "local",
          scope: "user",
          origin: "top-level",
          baseDir: dirname(path),
        },
      },
    ]);

    await expect(service.listPromptResources()).resolves.toEqual([
      expect.objectContaining({
        description: "Body fallback",
        content: "Body fallback\n",
      }),
    ]);
    expect((await service.listPromptResources())[0]).not.toHaveProperty(
      "argumentHint",
    );
  });

  test("keeps native snapshot metadata authoritative before reload", async () => {
    const { agentDir, runtime, service } = await setup();
    const path = join(agentDir, "configured", "snapshot.md");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      "---\ndescription: Edited on disk\nargument-hint: <NEW>\n---\nEdited body\n",
    );
    runtime.promptTemplates.mockReturnValue([
      {
        name: "snapshot",
        description: "Active description",
        argumentHint: "<ACTIVE>",
        content: "Active body\n",
        filePath: path,
        sourceInfo: {
          path,
          source: "local",
          scope: "user",
          origin: "top-level",
          baseDir: dirname(path),
        },
      },
    ]);

    await expect(service.listPromptResources()).resolves.toEqual([
      expect.objectContaining({
        description: "Active description",
        argumentHint: "<ACTIVE>",
        content: "Active body\n",
      }),
    ]);
  });

  test("creates and mutates only canonical user or trusted project prompts", async () => {
    const { agentDir, workspace, reload, runtime, service } = await setup();
    runtime.projectTrust.mockReturnValue({ required: true, trusted: true });

    await service.createPromptResource("user", "user-new", "User prompt\n");
    await service.createPromptResource(
      "project",
      "project-new",
      "Project prompt\n",
    );
    const userPath = join(agentDir, "prompts", "user-new.md");
    const projectPath = join(workspace, ".pi", "prompts", "project-new.md");
    expect(await readFile(userPath, "utf8")).toBe("User prompt\n");
    expect(await readFile(projectPath, "utf8")).toBe("Project prompt\n");

    const userPrompt: PromptTemplate = {
      name: "user-new",
      description: "User prompt",
      content: "User prompt\n",
      filePath: userPath,
      sourceInfo: {
        path: userPath,
        source: "local",
        scope: "user",
        origin: "top-level",
      },
    };
    runtime.promptTemplates.mockReturnValue([userPrompt]);
    const [resource] = await service.listPromptResources();
    if (!resource) throw new Error("Native prompt was not projected");
    await service.updatePromptResource(
      resource.id,
      "---\ndescription: Preserved\n---\nUpdated\n",
    );
    expect(await readFile(userPath, "utf8")).toContain(
      "description: Preserved",
    );
    await expect(
      service.updatePromptResource("prompt_stale", "stale"),
    ).rejects.toThrow(/not found/i);
    await service.deletePromptResource(resource.id);
    await expect(access(userPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(reload).toHaveBeenCalledTimes(9);

    const projectPrompt: PromptTemplate = {
      name: "project-new",
      description: "Project prompt",
      content: "Project prompt\n",
      filePath: projectPath,
      sourceInfo: {
        path: projectPath,
        source: "local",
        scope: "project",
        origin: "top-level",
      },
    };
    runtime.promptTemplates.mockReturnValue([projectPrompt]);
    const [projectResource] = await service.listPromptResources();
    if (!projectResource) throw new Error("Project prompt was not projected");
    runtime.projectTrust.mockReturnValue({ required: true, trusted: false });
    await expect(
      service.updatePromptResource(projectResource.id, "Denied"),
    ).rejects.toBeInstanceOf(ResourcePermissionError);
    await expect(
      service.deletePromptResource(projectResource.id),
    ).rejects.toBeInstanceOf(ResourcePermissionError);
    expect(await readFile(projectPath, "utf8")).toBe("Project prompt\n");
    await expect(
      service.createPromptResource("project", "denied", "Denied"),
    ).rejects.toBeInstanceOf(ResourcePermissionError);
    await expect(
      access(join(workspace, ".pi", "prompts", "denied.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects create conflicts without hiding higher-precedence winners", async () => {
    const { agentDir, workspace, runtime, service } = await setup();
    const promptDir = join(agentDir, "prompts");
    const target = join(promptDir, "review.md");
    await mkdir(promptDir, { recursive: true });
    await writeFile(target, "Existing hidden prompt\n");

    await expect(
      service.createPromptResource("user", "review", "Replacement\n"),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    expect(await readFile(target, "utf8")).toBe("Existing hidden prompt\n");

    await rm(target);
    const settingsPath = join(agentDir, "configured", "review.md");
    await mkdir(resolve(settingsPath, ".."), { recursive: true });
    await writeFile(settingsPath, "Settings winner\n");
    runtime.promptTemplates.mockReturnValue([
      {
        name: "review",
        description: "Settings winner",
        content: "Settings winner\n",
        filePath: settingsPath,
        sourceInfo: {
          path: settingsPath,
          source: "local",
          scope: "user",
          origin: "top-level",
        },
      },
    ]);
    await expect(
      service.createPromptResource("user", "review", "Hidden loser\n"),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    await expect(
      service.writeDocument("template", "review", "Legacy hidden loser\n"),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    await writeFile(target, "Hidden canonical prompt\n");
    await expect(service.listTemplates()).resolves.toEqual([]);
    await expect(
      service.deleteDocument("template", "review"),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    expect(await readFile(target, "utf8")).toBe("Hidden canonical prompt\n");
    await rm(target);

    runtime.promptTemplates.mockReturnValue([
      {
        name: "review",
        description: "Temporary package winner",
        content: "Temporary package winner\n",
        filePath: "/private/temporary-package/prompts/review.md",
        sourceInfo: {
          path: "/private/temporary-package/prompts/review.md",
          source: "npm:temporary-review-package",
          scope: "temporary",
          origin: "package",
        },
      },
    ]);
    await expect(
      service.createPromptResource("user", "review", "Hidden loser\n"),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    await expect(access(target)).rejects.toMatchObject({ code: "ENOENT" });

    const cliPath = join(agentDir, "cli", "review.md");
    await mkdir(dirname(cliPath), { recursive: true });
    await writeFile(cliPath, "CLI winner\n");
    await writeFile(target, "Canonical candidate\n");
    const cliLoader = new DefaultResourceLoader({
      cwd: workspace,
      agentDir,
      settingsManager: SettingsManager.create(workspace, agentDir),
      additionalPromptTemplatePaths: [cliPath],
    });
    await cliLoader.reload();
    expect(cliLoader.getPrompts().prompts).toHaveLength(1);
    expect(cliLoader.getPrompts().prompts[0]?.filePath).toBe(target);
    expect(cliLoader.getPrompts().prompts[0]?.content).toBe(
      "Canonical candidate\n",
    );
    await rm(target);
    await cliLoader.reload();
    const [cliPrompt] = cliLoader.getPrompts().prompts;
    expect(cliPrompt?.filePath).toBe(cliPath);
    expect(cliPrompt?.content).toBe("CLI winner\n");
    expect(cliPrompt?.sourceInfo).toEqual(
      expect.objectContaining({
        source: "local",
        scope: "temporary",
        origin: "top-level",
      }),
    );
    if (!cliPrompt) throw new Error("CLI prompt was not discovered");
    runtime.promptTemplates.mockReturnValue([cliPrompt]);
    await service.createPromptResource("user", "review", "User winner\n");
    expect(await readFile(target, "utf8")).toBe("User winner\n");
    await service.writeDocument("template", "review", "Legacy winner\n");
    expect(await readFile(target, "utf8")).toBe("Legacy winner\n");
    await service.deleteDocument("template", "review");
    await expect(access(target)).rejects.toMatchObject({ code: "ENOENT" });

    runtime.promptTemplates.mockReturnValue([
      {
        name: "review",
        description: "Package winner",
        content: "Package winner\n",
        filePath: "/private/package/prompts/review.md",
        sourceInfo: {
          path: "/private/package/prompts/review.md",
          source: "npm:review-package",
          scope: "user",
          origin: "package",
        },
      },
    ]);
    await service.createPromptResource("user", "review", "User override\n");
    expect(await readFile(target, "utf8")).toBe("User override\n");
  });

  test("does not create project directories for a conflicting create", async () => {
    const { workspace, runtime, service } = await setup();
    runtime.projectTrust.mockReturnValue({ required: true, trusted: true });
    runtime.promptTemplates.mockReturnValue([
      {
        name: "blocked",
        description: "Temporary package winner",
        content: "Winner\n",
        filePath: "/private/temporary-package/prompts/blocked.md",
        sourceInfo: {
          path: "/private/temporary-package/prompts/blocked.md",
          source: "npm:temporary-package",
          scope: "temporary",
          origin: "package",
        },
      },
    ]);

    await expect(
      service.createPromptResource("project", "blocked", "Hidden loser\n"),
    ).rejects.toBeInstanceOf(ResourceConflictError);

    await expect(access(join(workspace, ".pi"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("supports explicitly configured symlinked agent and workspace roots", async () => {
    const { packages, runtime } = await setup();
    const container = await mkdtemp(join(tmpdir(), "pi-agent-linked-roots-"));
    directories.push(container);
    const realAgentDir = join(container, "real-agent");
    const realWorkspace = join(container, "real-workspace");
    const agentDir = join(container, "agent-link");
    const workspace = join(container, "workspace-link");
    await Promise.all([
      mkdir(realAgentDir, { recursive: true }),
      mkdir(realWorkspace, { recursive: true }),
    ]);
    await Promise.all([
      symlink(realAgentDir, agentDir),
      symlink(realWorkspace, workspace),
    ]);
    runtime.projectTrust.mockReturnValue({ required: true, trusted: true });
    const service = new ResourceService(
      agentDir,
      workspace,
      packages as never,
      runtime,
    );

    await service.createPromptResource("user", "linked-user", "User body\n");
    await service.createPromptResource(
      "project",
      "linked-project",
      "Project body\n",
    );
    const userPath = join(agentDir, "prompts", "linked-user.md");
    const projectPath = join(workspace, ".pi", "prompts", "linked-project.md");
    const prompts: PromptTemplate[] = [
      {
        name: "linked-user",
        description: "User body",
        content: "User body\n",
        filePath: userPath,
        sourceInfo: {
          path: userPath,
          source: "local",
          scope: "user",
          origin: "top-level",
        },
      },
      {
        name: "linked-project",
        description: "Project body",
        content: "Project body\n",
        filePath: projectPath,
        sourceInfo: {
          path: projectPath,
          source: "local",
          scope: "project",
          origin: "top-level",
        },
      },
    ];
    runtime.promptTemplates.mockReturnValue(prompts);
    const resources = await service.listPromptResources();
    expect(resources).toEqual([
      expect.objectContaining({ name: "linked-user", editable: true }),
      expect.objectContaining({ name: "linked-project", editable: true }),
    ]);
    await service.updatePromptResource(resources[0]?.id ?? "", "Updated\n");
    expect(
      await readFile(join(realAgentDir, "prompts", "linked-user.md"), "utf8"),
    ).toBe("Updated\n");
    await service.deletePromptResource(resources[1]?.id ?? "");
    await expect(
      access(join(realWorkspace, ".pi", "prompts", "linked-project.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("pins configured symlink roots against retargeting", async () => {
    const { packages, runtime } = await setup();
    const container = await mkdtemp(
      join(tmpdir(), "pi-agent-retargeted-root-"),
    );
    directories.push(container);
    const firstAgentDir = join(container, "agent-a");
    const secondAgentDir = join(container, "agent-b");
    const agentDir = join(container, "agent-link");
    const workspace = join(container, "workspace");
    await Promise.all([
      mkdir(firstAgentDir, { recursive: true }),
      mkdir(secondAgentDir, { recursive: true }),
      mkdir(workspace, { recursive: true }),
    ]);
    await symlink(firstAgentDir, agentDir);
    const service = new ResourceService(
      agentDir,
      workspace,
      packages as never,
      runtime,
    );
    await service.createPromptResource("user", "pinned", "Pinned body\n");
    const path = join(agentDir, "prompts", "pinned.md");
    runtime.promptTemplates.mockReturnValue([
      {
        name: "pinned",
        description: "Pinned body",
        content: "Pinned body\n",
        filePath: path,
        sourceInfo: {
          path,
          source: "local",
          scope: "user",
          origin: "top-level",
        },
      },
    ]);
    const [before] = await service.listPromptResources();
    expect(before).toEqual(expect.objectContaining({ editable: true }));
    if (!before) throw new Error("Pinned prompt was not projected");

    await rm(agentDir);
    await symlink(secondAgentDir, agentDir);

    await expect(service.listPromptResources()).resolves.toEqual([
      expect.objectContaining({
        id: before.id,
        content: "",
        editable: false,
      }),
    ]);
    await expect(
      service.createPromptResource("user", "redirected", "Denied\n"),
    ).rejects.toThrow(/root changed/i);
    await expect(
      service.updatePromptResource(before.id, "Denied\n"),
    ).rejects.toBeInstanceOf(ResourcePermissionError);
    await expect(access(join(secondAgentDir, "prompts"))).rejects.toMatchObject(
      {
        code: "ENOENT",
      },
    );
  });

  test("rejects a symlinked project directory before creating outside it", async () => {
    const { agentDir, workspace, runtime, service } = await setup();
    const outside = join(agentDir, "outside-project");
    const escaped = join(outside, "prompts", "escaped.md");
    await mkdir(dirname(escaped), { recursive: true });
    await writeFile(escaped, "Outside existing prompt\n");
    await symlink(outside, join(workspace, ".pi"));
    runtime.projectTrust.mockReturnValue({ required: true, trusted: true });

    await expect(
      service.createPromptResource("project", "escaped", "Denied\n"),
    ).rejects.toThrow(/real directory/i);

    await expect(readFile(escaped, "utf8")).resolves.toBe(
      "Outside existing prompt\n",
    );
  });

  test("does not recreate prompt directories while listing a stale snapshot", async () => {
    const { workspace, runtime, service } = await setup();
    const path = join(workspace, ".pi", "prompts", "stale.md");
    runtime.projectTrust.mockReturnValue({ required: true, trusted: true });
    runtime.promptTemplates.mockReturnValue([
      {
        name: "stale",
        description: "Stale prompt",
        content: "Native snapshot body",
        filePath: path,
        sourceInfo: {
          path,
          source: "auto",
          scope: "project",
          origin: "top-level",
        },
      },
    ]);

    await expect(service.listPromptResources()).resolves.toEqual([
      expect.objectContaining({
        name: "stale",
        content: "",
        editable: false,
        deletable: false,
      }),
    ]);
    await expect(access(join(workspace, ".pi"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("rejects package and symlink prompt mutations", async () => {
    const { agentDir, runtime, service } = await setup();
    const target = join(agentDir, "outside.md");
    const link = join(agentDir, "prompts", "linked.md");
    await mkdir(join(agentDir, "prompts"), { recursive: true });
    await writeFile(target, "Filesystem secret\n");
    await symlink(target, link);
    const prompts: PromptTemplate[] = [
      {
        name: "package",
        description: "Package",
        content: "Package content",
        filePath: "/private/package/prompts/package.md",
        sourceInfo: {
          path: "/private/package/prompts/package.md",
          source: "npm:safe-package",
          scope: "user",
          origin: "package",
        },
      },
      {
        name: "linked",
        description: "Linked",
        content: "Native snapshot body",
        filePath: link,
        sourceInfo: {
          path: link,
          source: "local",
          scope: "user",
          origin: "top-level",
        },
      },
    ];
    runtime.promptTemplates.mockReturnValue(prompts);
    const resources = await service.listPromptResources();

    expect(
      resources.find((resource) => resource.name === "linked")?.content,
    ).toBe("");
    expect(JSON.stringify(resources)).not.toContain("Filesystem secret");
    for (const resource of resources) {
      expect(resource.editable).toBe(false);
      await expect(
        service.updatePromptResource(resource.id, "Denied"),
      ).rejects.toBeInstanceOf(ResourcePermissionError);
      await expect(
        service.deletePromptResource(resource.id),
      ).rejects.toBeInstanceOf(ResourcePermissionError);
    }
    expect(await readFile(target, "utf8")).toBe("Filesystem secret\n");
  });

  test("discovers and atomically edits mounted Pi prompts", async () => {
    const { agentDir, reload, runtime, service } = await setup();
    await service.writeDocument("system", undefined, "You are concise.\n");
    await service.writeDocument("template", "review", "Review this.\n");
    const promptPath = join(agentDir, "prompts", "review.md");
    runtime.promptTemplates.mockReturnValue([
      {
        name: "review",
        description: "Review this.",
        content: "Review this.\n",
        filePath: promptPath,
        sourceInfo: {
          path: promptPath,
          source: "auto",
          scope: "user",
          origin: "top-level",
        },
      },
    ]);

    expect(await readFile(join(agentDir, "SYSTEM.md"), "utf8")).toBe(
      "You are concise.\n",
    );
    expect(await service.listTemplates()).toEqual([
      {
        name: "review",
        content: "Review this.\n",
        provenance: { scope: "user", origin: "top-level" },
      },
    ]);
    expect(reload).toHaveBeenCalledTimes(3);
  });

  test("truncates native prompt responses on the UTF-8 byte limit", async () => {
    const { agentDir, runtime, service } = await setup();
    const path = join(agentDir, "prompts", "large.md");
    const content = "界".repeat(400_000);
    const raw = `---\ndescription: Large prompt\n---\n${content}`;
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, raw);
    runtime.promptTemplates.mockReturnValue([
      {
        name: "large",
        description: "Large prompt",
        content,
        filePath: path,
        sourceInfo: {
          path,
          source: "auto",
          scope: "user",
          origin: "top-level",
        },
      },
    ]);

    const [resource] = await service.listPromptResources();

    expect(resource).toEqual(
      expect.objectContaining({
        contentTruncated: true,
        editable: false,
        deletable: true,
      }),
    );
    expect(Buffer.byteLength(resource?.content ?? "")).toBeLessThanOrEqual(
      1_000_000,
    );
    expect(resource?.content.startsWith("---\ndescription: Large prompt")).toBe(
      true,
    );
    expect(resource?.content.endsWith("�")).toBe(false);
    if (!resource) throw new Error("Large prompt was not projected");
    await expect(service.listTemplates()).resolves.toEqual([]);
    await expect(
      service.writeDocument("template", "large", "Incomplete replacement"),
    ).rejects.toBeInstanceOf(ResourcePermissionError);
    expect((await readFile(path, "utf8")).length).toBe(raw.length);
    await service.deletePromptResource(resource.id);
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      service.updatePromptResource(resource.id, "Stale replacement"),
    ).rejects.toThrow(/not found/i);
    await expect(service.deletePromptResource(resource.id)).rejects.toThrow(
      /not found/i,
    );
  });

  test("returns a bounded raw prefix when frontmatter is oversized", async () => {
    const { agentDir, runtime, service } = await setup();
    const path = join(agentDir, "prompts", "large-frontmatter.md");
    const body = "Short parsed body";
    const raw = `---\ndescription: ${"x".repeat(1_000_000)}\n---\n${body}`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, raw);
    runtime.promptTemplates.mockReturnValue([
      {
        name: "large-frontmatter",
        description: "Large frontmatter",
        content: body,
        filePath: path,
        sourceInfo: {
          path,
          source: "auto",
          scope: "user",
          origin: "top-level",
        },
      },
    ]);

    await expect(service.listPromptResources()).resolves.toEqual([
      expect.objectContaining({
        description: "Large frontmatter",
        content: expect.stringMatching(/^---\ndescription: x+$/),
        contentTruncated: true,
        editable: false,
        deletable: true,
      }),
    ]);
  });

  test("does not recreate a prompt removed after update validation", async () => {
    const { agentDir, runtime, service } = await setup();
    const path = join(agentDir, "prompts", "stale-update.md");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "Original\n");
    const prompt: PromptTemplate = {
      name: "stale-update",
      description: "Original",
      content: "Original\n",
      filePath: path,
      sourceInfo: {
        path,
        source: "local",
        scope: "user",
        origin: "top-level",
      },
    };
    runtime.promptTemplates.mockReturnValue([prompt]);
    const [resource] = await service.listPromptResources();
    if (!resource) throw new Error("Stale prompt was not projected");
    interface MutationTarget {
      path: string;
      parent: string;
      dev: number;
      ino: number;
    }
    const internal = service as unknown as {
      persistPromptTarget(
        target: MutationTarget,
        content: string,
      ): Promise<void>;
    };
    const persistPromptTarget = internal.persistPromptTarget.bind(service);
    internal.persistPromptTarget = async (target, content) => {
      await rm(path, { force: true });
      await persistPromptTarget(target, content);
    };

    await expect(
      service.updatePromptResource(resource.id, "Replacement\n"),
    ).rejects.toThrow(/not found/i);
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects same-path replacements during opaque prompt mutations", async () => {
    const { agentDir, runtime, service } = await setup();
    const path = join(agentDir, "prompts", "vanishing.md");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "Original\n");
    const prompt: PromptTemplate = {
      name: "vanishing",
      description: "Original",
      content: "Original\n",
      filePath: path,
      sourceInfo: {
        path,
        source: "local",
        scope: "user",
        origin: "top-level",
      },
    };
    runtime.promptTemplates.mockReturnValue([prompt]);
    const [resource] = await service.listPromptResources();
    if (!resource) throw new Error("Vanishing prompt was not projected");
    interface MutationTarget {
      path: string;
      parent: string;
      dev: number;
      ino: number;
    }
    const internal = service as unknown as {
      assertPromptTarget(target: MutationTarget): Promise<void>;
    };
    const assertPromptTarget = internal.assertPromptTarget.bind(service);
    let replacement = "Concurrent replacement\n";
    internal.assertPromptTarget = async (target) => {
      await assertPromptTarget(target);
      await rm(path, { force: true });
      await writeFile(path, replacement);
    };

    await expect(
      service.updatePromptResource(resource.id, "Updated\n"),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    expect(await readFile(path, "utf8")).toBe("Concurrent replacement\n");

    replacement = "Delete replacement\n";
    await expect(
      service.deletePromptResource(resource.id),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    expect(await readFile(path, "utf8")).toBe("Delete replacement\n");
  });

  test("rejects same-size in-place writes during prompt mutations", async () => {
    const { agentDir, runtime, service } = await setup();
    const path = join(agentDir, "prompts", "in-place.md");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "Original\n");
    const prompt: PromptTemplate = {
      name: "in-place",
      description: "Original",
      content: "Original\n",
      filePath: path,
      sourceInfo: {
        path,
        source: "local",
        scope: "user",
        origin: "top-level",
      },
    };
    runtime.promptTemplates.mockReturnValue([prompt]);
    const [resource] = await service.listPromptResources();
    if (!resource) throw new Error("In-place prompt was not projected");
    interface MutationTarget {
      path: string;
      parent: string;
      dev: number;
      ino: number;
      ctimeMs: number;
    }
    const internal = service as unknown as {
      assertPromptTarget(target: MutationTarget): Promise<void>;
    };
    const assertPromptTarget = internal.assertPromptTarget.bind(service);
    let replacement = "Changed!\n";
    internal.assertPromptTarget = async (target) => {
      await assertPromptTarget(target);
      await writeFile(path, replacement);
      if ((await lstat(path)).ctimeMs === target.ctimeMs) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await writeFile(path, replacement);
      }
    };

    await expect(
      service.updatePromptResource(resource.id, "Updated!\n"),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    expect(await readFile(path, "utf8")).toBe("Changed!\n");

    replacement = "Deleted!\n";
    await expect(
      service.deletePromptResource(resource.id),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    expect(await readFile(path, "utf8")).toBe("Deleted!\n");
  });

  test("rejects same-path replacements during legacy prompt mutations", async () => {
    const { agentDir, service } = await setup();
    const path = join(agentDir, "prompts", "legacy-race.md");
    await service.writeDocument("template", "legacy-race", "Original\n");
    interface MutationTarget {
      path: string;
      parent: string;
      dev: number;
      ino: number;
    }
    const internal = service as unknown as {
      assertPromptTarget(target: MutationTarget): Promise<void>;
    };
    const assertPromptTarget = internal.assertPromptTarget.bind(service);
    let replacement = "Legacy replacement\n";
    internal.assertPromptTarget = async (target) => {
      await assertPromptTarget(target);
      await rm(path, { force: true });
      await writeFile(path, replacement);
    };
    await expect(
      service.writeDocument("template", "legacy-race", "Updated\n"),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    expect(await readFile(path, "utf8")).toBe("Legacy replacement\n");

    replacement = "Legacy delete replacement\n";
    await expect(
      service.deleteDocument("template", "legacy-race"),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    expect(await readFile(path, "utf8")).toBe("Legacy delete replacement\n");
  });

  test("rejects an oversized multibyte document before persistence or reload", async () => {
    const { agentDir, reload, service } = await setup();
    const content = "界".repeat(333_334);
    expect(Buffer.byteLength(content)).toBeGreaterThan(1_000_000);

    await expect(
      service.writeDocument("system", undefined, content),
    ).rejects.toThrow(/too large/i);

    await expect(
      readFile(join(agentDir, "SYSTEM.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(reload).not.toHaveBeenCalled();
  });

  test("reloads after an idempotent delete reconciles an externally removed document", async () => {
    const { agentDir, reload, service } = await setup();
    const path = join(agentDir, "prompts", "temporary.md");
    await service.writeDocument("template", "temporary", "Delete me.\n");
    await rm(path);
    reload.mockClear();

    await service.deleteDocument("template", "temporary");

    await expect(readFile(path, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(reload).toHaveBeenCalledTimes(2);
  });

  test("rejects hard-linked managed documents and canonical prompts", async () => {
    const { agentDir, runtime, service } = await setup();
    const outsideDir = await mkdtemp(join(tmpdir(), "pi-agent-hard-link-"));
    directories.push(outsideDir);
    const outside = join(outsideDir, "outside-hard-link.md");
    const system = join(agentDir, "SYSTEM.md");
    const promptPath = join(agentDir, "prompts", "hard-linked.md");
    await mkdir(dirname(promptPath), { recursive: true });
    await writeFile(outside, "Hard-linked filesystem secret\n");
    await link(outside, system);
    await link(outside, promptPath);
    runtime.promptTemplates.mockReturnValue([
      {
        name: "hard-linked",
        description: "Hard-linked filesystem secret",
        content: "Hard-linked filesystem secret\n",
        filePath: promptPath,
        sourceInfo: {
          path: promptPath,
          source: "local",
          scope: "user",
          origin: "top-level",
        },
      },
    ]);

    await expect(service.readDocument("system")).rejects.toThrow(/hard link/i);
    await expect(
      service.writeDocument("system", undefined, "Replacement\n"),
    ).rejects.toThrow(/hard link/i);
    const [prompt] = await service.listPromptResources();
    expect(prompt).toEqual(
      expect.objectContaining({
        description: "",
        content: "",
        editable: false,
        deletable: false,
      }),
    );
    if (!prompt) throw new Error("Hard-linked prompt was not projected");
    await expect(
      service.updatePromptResource(prompt.id, "Replacement\n"),
    ).rejects.toBeInstanceOf(ResourcePermissionError);
    await expect(
      service.deletePromptResource(prompt.id),
    ).rejects.toBeInstanceOf(ResourcePermissionError);
    expect(await readFile(outside, "utf8")).toBe(
      "Hard-linked filesystem secret\n",
    );
  });

  test("rejects path traversal and symlink replacement", async () => {
    const { agentDir, service } = await setup();
    await expect(
      service.writeDocument("template", "../auth", "bad"),
    ).rejects.toThrow(/name/i);
    await writeFile(join(agentDir, "outside"), "safe");
    await expect(
      service.writeDocument("template", "bad/name", "bad"),
    ).rejects.toThrow(/name/i);
    await service.writeDocument("template", "linked", "safe");
    await rm(join(agentDir, "prompts", "linked.md"));
    await symlink(
      join(agentDir, "outside"),
      join(agentDir, "prompts", "linked.md"),
    );
    await expect(
      service.writeDocument("template", "linked", "bad"),
    ).rejects.toBeInstanceOf(ResourcePermissionError);
    expect(await readFile(join(agentDir, "outside"), "utf8")).toBe("safe");
  });

  test("reloads only after a package operation completes", async () => {
    const { service, packages, reload } = await setup();
    let finishInstall: (() => void) | undefined;
    packages.installAndPersist.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishInstall = resolve;
        }),
    );

    const installing = service.installPackage("npm:example@1.0.0");
    await vi.waitFor(() => expect(finishInstall).toBeTypeOf("function"));
    expect(reload).not.toHaveBeenCalled();
    finishInstall?.();
    await installing;

    expect(packages.installAndPersist).toHaveBeenCalledWith(
      "npm:example@1.0.0",
    );
    expect(reload).toHaveBeenCalledOnce();
  });

  test("accepts native git protocol package sources", async () => {
    const { service, packages } = await setup();

    await service.installPackage("git://example.com/org/prompts.git");

    expect(packages.installAndPersist).toHaveBeenCalledWith(
      "git://example.com/org/prompts.git",
    );
  });

  test("resolves opaque IDs for native package updates and removal", async () => {
    const { service, packages, reload } = await setup();
    packages.listConfiguredPackages.mockReturnValue([
      {
        source: "../../../workspace/package",
        scope: "project",
        filtered: false,
        installedPath: "/private/cache/package",
      },
    ]);
    const [summary] = service.listPackages();
    if (!summary) throw new Error("Package summary is required");

    expect(summary).toMatchObject({
      name: expect.stringMatching(/^package-[a-f0-9]{8}$/),
      scope: "project",
      filtered: false,
      provenance: { scope: "project", origin: "package" },
    });
    expect(JSON.stringify(summary)).not.toContain("workspace");
    expect(JSON.stringify(summary)).not.toContain("/private");

    await service.updatePackage(summary.id);
    await service.removePackage(summary.id);

    expect(packages.update).toHaveBeenCalledWith("../../../workspace/package");
    expect(packages.removeAndPersist).toHaveBeenCalledWith(
      "../../../workspace/package",
    );
    expect(reload).toHaveBeenCalledTimes(2);
    expect(packages.update.mock.invocationCallOrder[0]).toBeLessThan(
      reload.mock.invocationCallOrder[0] ?? 0,
    );
    expect(packages.removeAndPersist.mock.invocationCallOrder[0]).toBeLessThan(
      reload.mock.invocationCallOrder[1] ?? 0,
    );
  });

  test("does not reload after a failed native package operation", async () => {
    const { service, packages, reload } = await setup();
    packages.installAndPersist.mockRejectedValueOnce(
      new Error("package install failed"),
    );

    await expect(service.installPackage("npm:example@1.0.0")).rejects.toThrow(
      "package install failed",
    );

    expect(reload).not.toHaveBeenCalled();
  });

  test("does not reload after a no-op package removal", async () => {
    const { service, packages, reload } = await setup();
    packages.listConfiguredPackages.mockReturnValue([
      {
        source: "npm:example@1.0.0",
        scope: "user",
        filtered: false,
      },
    ]);
    packages.removeAndPersist.mockResolvedValueOnce(false);
    const [summary] = service.listPackages();
    if (!summary) throw new Error("Package summary is required");

    await expect(service.removePackage(summary.id)).resolves.toBe(false);

    expect(reload).not.toHaveBeenCalled();
  });

  test("propagates native reload errors after persistence", async () => {
    const { agentDir, service, reload } = await setup();
    reload.mockRejectedValueOnce(new Error("native reload failed"));

    await expect(
      service.writeDocument("system", undefined, "Persisted first.\n"),
    ).rejects.toThrow("native reload failed");

    await expect(readFile(join(agentDir, "SYSTEM.md"), "utf8")).resolves.toBe(
      "Persisted first.\n",
    );
  });

  test("rejects stale package IDs without mutating native settings", async () => {
    const { service, packages, reload } = await setup();

    await expect(service.updatePackage("pkg_unknown")).rejects.toThrow(
      /not found/i,
    );
    await expect(service.removePackage("pkg_unknown")).rejects.toThrow(
      /not found/i,
    );

    expect(packages.update).not.toHaveBeenCalled();
    expect(packages.removeAndPersist).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
