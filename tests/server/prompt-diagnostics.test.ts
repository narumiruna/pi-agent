import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DefaultResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ResourceService,
  type ResourceValidationError,
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
  const agentDir = await mkdtemp(join(tmpdir(), "pi-agent-diagnostics-"));
  const workspace = await mkdtemp(
    join(tmpdir(), "pi-agent-diagnostics-workspace-"),
  );
  directories.push(agentDir, workspace);
  const packages = {
    installAndPersist: vi.fn(async () => undefined),
    listConfiguredPackages: vi.fn(() => []),
    removeAndPersist: vi.fn(async () => true),
    update: vi.fn(async () => undefined),
  };
  const runtime = {
    reload: vi.fn(async () => undefined),
    mutateResources: async <T>(operation: () => Promise<T>): Promise<T> =>
      operation(),
    projectTrust: vi.fn(() => ({ required: false, trusted: false })),
    promptDiagnostics: vi.fn(() => []),
    promptTemplates: vi.fn(() => []),
  };
  return {
    agentDir,
    packages,
    runtime,
    service: new ResourceService(
      agentDir,
      workspace,
      packages as never,
      runtime,
    ),
    workspace,
  };
}

describe("prompt diagnostics", () => {
  test("projects path-safe validation and Pi-native collisions", async () => {
    const { agentDir, workspace, packages } = await setup();
    const userRoot = join(agentDir, "prompts");
    const projectRoot = join(workspace, ".pi", "prompts");
    await Promise.all([
      mkdir(userRoot, { recursive: true }),
      mkdir(projectRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(userRoot, ".hidden.md"), "Hidden prompt\n"),
      writeFile(
        join(userRoot, "broken.md"),
        "---\ndescription: [\n---\nBroken\n",
      ),
      writeFile(
        join(userRoot, "typed.md"),
        "---\ndescription: 42\n---\nTyped\n",
      ),
      writeFile(join(userRoot, "large.md"), "é".repeat(500_001)),
      writeFile(join(userRoot, "review.md"), "User review\n"),
      writeFile(join(projectRoot, "review.md"), "Project review\n"),
    ]);
    const loader = new DefaultResourceLoader({
      cwd: workspace,
      agentDir,
      settingsManager: SettingsManager.create(workspace, agentDir, {
        projectTrusted: true,
      }),
    });
    await loader.reload();
    expect(
      loader.getPrompts().prompts.some(({ name }) => name === "broken"),
    ).toBe(false);
    expect(loader.getPrompts().diagnostics).toEqual([
      expect.objectContaining({
        type: "collision",
        collision: expect.objectContaining({
          resourceType: "prompt",
          name: "review",
        }),
      }),
    ]);
    const service = new ResourceService(
      agentDir,
      workspace,
      packages as never,
      {
        reload: async () => loader.reload(),
        mutateResources: async <T>(operation: () => Promise<T>) => operation(),
        projectTrust: () => ({ required: true, trusted: true }),
        promptDiagnostics: () => loader.getPrompts().diagnostics,
        promptTemplates: () => loader.getPrompts().prompts,
      },
    );

    const diagnostics = await service.listPromptDiagnostics();

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_name",
          severity: "error",
          name: ".hidden",
          path: "~/.pi/agent/prompts/.hidden.md",
        }),
        expect.objectContaining({
          code: "invalid_frontmatter",
          severity: "error",
          name: "broken",
          path: "~/.pi/agent/prompts/broken.md",
        }),
        expect.objectContaining({
          code: "invalid_frontmatter",
          severity: "error",
          name: "typed",
          path: "~/.pi/agent/prompts/typed.md",
        }),
        expect.objectContaining({
          code: "content_too_large",
          severity: "error",
          name: "large",
          path: "~/.pi/agent/prompts/large.md",
        }),
        expect.objectContaining({
          code: "name_collision",
          severity: "warning",
          name: "review",
          path: expect.stringMatching(
            /^(?:\.pi\/prompts|~\/\.pi\/agent\/prompts)\/review\.md$/,
          ),
          relatedPath: expect.stringMatching(
            /^(?:\.pi\/prompts|~\/\.pi\/agent\/prompts)\/review\.md$/,
          ),
        }),
      ]),
    );
    expect(JSON.stringify(diagnostics)).not.toContain(agentDir);
    expect(JSON.stringify(diagnostics)).not.toContain(workspace);
  });

  test("validates omitted canonical prompts only after project trust", async () => {
    const { agentDir, workspace, runtime, service } = await setup();
    const userPath = join(agentDir, "prompts", "broken-user.md");
    const projectPath = join(workspace, ".pi", "prompts", "broken-project.md");
    await Promise.all([
      mkdir(dirname(userPath), { recursive: true }),
      mkdir(dirname(projectPath), { recursive: true }),
    ]);
    const invalid = "---\ndescription: [\n---\nBroken\n";
    await Promise.all([
      writeFile(userPath, invalid),
      writeFile(projectPath, invalid),
    ]);

    await expect(service.listPromptDiagnostics()).resolves.toEqual([
      expect.objectContaining({
        code: "invalid_frontmatter",
        path: "~/.pi/agent/prompts/broken-user.md",
      }),
    ]);

    runtime.projectTrust.mockReturnValue({ required: true, trusted: true });
    await expect(service.listPromptDiagnostics()).resolves.toEqual([
      expect.objectContaining({
        code: "invalid_frontmatter",
        path: ".pi/prompts/broken-project.md",
      }),
      expect.objectContaining({
        code: "invalid_frontmatter",
        path: "~/.pi/agent/prompts/broken-user.md",
      }),
    ]);
  });

  test("rejects invalid writes before changing canonical files", async () => {
    const { agentDir, runtime, service } = await setup();
    const promptRoot = join(agentDir, "prompts");
    const existingPath = join(promptRoot, "existing.md");
    await mkdir(promptRoot, { recursive: true });
    await writeFile(existingPath, "Existing\n");
    runtime.promptTemplates.mockReturnValue([
      {
        name: "existing",
        description: "Existing",
        content: "Existing\n",
        filePath: existingPath,
        sourceInfo: {
          path: existingPath,
          source: "local",
          scope: "user",
          origin: "top-level",
        },
      },
    ]);
    const [existing] = await service.listPromptResources();
    if (!existing) throw new Error("Expected existing prompt");
    const malformed = "---\ndescription: [\n---\nBroken\n";

    await expect(
      service.createPromptResource("user", "broken", malformed),
    ).rejects.toMatchObject<ResourceValidationError>({
      diagnostic: "invalid_frontmatter",
    });
    await expect(
      service.writeDocument("template", "bad name", "Body\n"),
    ).rejects.toMatchObject<ResourceValidationError>({
      diagnostic: "invalid_name",
    });
    await expect(
      service.createPromptResource("user", "large", "é".repeat(500_001)),
    ).rejects.toMatchObject<ResourceValidationError>({
      diagnostic: "content_too_large",
    });
    await expect(
      service.updatePromptResource(existing.id, malformed),
    ).rejects.toMatchObject<ResourceValidationError>({
      diagnostic: "invalid_frontmatter",
    });

    expect(await readFile(existingPath, "utf8")).toBe("Existing\n");
    await expect(access(join(promptRoot, "broken.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(promptRoot, "large.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
