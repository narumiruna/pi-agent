import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DefaultResourceLoader,
  ProjectTrustStore,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ProjectTrustPolicy,
  withProjectTrustRollback,
} from "../../src/server/agent/project-trust.js";
import { ResourceService } from "../../src/server/resources/service.js";

const directories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("ProjectTrustPolicy", () => {
  test.each([
    {
      name: "no gated resources",
      required: false,
      saved: null,
      fallback: "never" as const,
      trusted: false,
    },
    {
      name: "proactive saved allow",
      required: false,
      saved: true,
      fallback: "never" as const,
      trusted: true,
    },
    {
      name: "saved allow",
      required: true,
      saved: true,
      fallback: "never" as const,
      trusted: true,
    },
    {
      name: "saved deny",
      required: true,
      saved: false,
      fallback: "always" as const,
      trusted: false,
    },
    {
      name: "global always",
      required: true,
      saved: null,
      fallback: "always" as const,
      trusted: true,
    },
    {
      name: "global ask",
      required: true,
      saved: null,
      fallback: "ask" as const,
      trusted: false,
    },
    {
      name: "global never",
      required: true,
      saved: null,
      fallback: "never" as const,
      trusted: false,
    },
  ])("resolves $name", ({ required, saved, fallback, trusted }) => {
    const settings = SettingsManager.inMemory(
      { defaultProjectTrust: fallback },
      { projectTrusted: false },
    );
    const store = {
      get: vi.fn(() => saved),
      set: vi.fn(),
    };
    const policy = new ProjectTrustPolicy(
      "/workspace",
      "/agent",
      settings,
      store,
      () => required,
    );

    expect(policy.initialize()).toEqual({ required, trusted });
    expect(settings.isProjectTrusted()).toBe(trusted);
    expect(store.get).toHaveBeenCalledOnce();
  });

  test("refreshes the global default before resolving trust", async () => {
    const workspace = await temporaryDirectory("pi-agent-trust-refresh-");
    const agentDir = await temporaryDirectory("pi-agent-trust-settings-");
    await mkdir(join(workspace, ".pi", "extensions"), { recursive: true });
    await writeFile(
      join(agentDir, "settings.json"),
      '{"defaultProjectTrust":"always"}\n',
    );
    const settings = SettingsManager.create(workspace, agentDir, {
      projectTrusted: false,
    });
    const policy = new ProjectTrustPolicy(workspace, agentDir, settings);

    await expect(policy.refresh()).resolves.toEqual({
      required: true,
      trusted: true,
    });
    await writeFile(
      join(agentDir, "settings.json"),
      '{"defaultProjectTrust":"never"}\n',
    );
    await expect(policy.refresh()).resolves.toEqual({
      required: true,
      trusted: false,
    });
    expect(settings.isProjectTrusted()).toBe(false);
  });

  test("keeps proactive trust when creating the first project prompt", async () => {
    const workspace = await temporaryDirectory("pi-agent-trust-clean-");
    const agentDir = await temporaryDirectory("pi-agent-trust-agent-");
    const settings = SettingsManager.create(workspace, agentDir, {
      projectTrusted: false,
    });
    const policy = new ProjectTrustPolicy(workspace, agentDir, settings);
    const loader = new DefaultResourceLoader({
      cwd: workspace,
      agentDir,
      settingsManager: settings,
    });
    expect(policy.initialize()).toEqual({ required: false, trusted: false });
    await loader.reload();

    policy.persist(true);
    expect(policy.initialize()).toEqual({ required: false, trusted: true });
    const reload = async () => loader.reload();
    const runtime = {
      reload,
      mutateResources: async <T>(operation: () => Promise<T>): Promise<T> => {
        await policy.refresh();
        await loader.reload();
        const result = await operation();
        await loader.reload();
        return result;
      },
      projectTrust: () => policy.status(),
      promptTemplates: () => loader.getPrompts().prompts,
    };
    const packages = {
      installAndPersist: async () => undefined,
      listConfiguredPackages: () => [],
      removeAndPersist: async () => false,
      update: async () => undefined,
    };
    const service = new ResourceService(
      agentDir,
      workspace,
      packages as never,
      runtime,
    );

    await service.createPromptResource(
      "project",
      "first-project-prompt",
      "First project prompt\n",
    );

    expect(
      await readFile(
        join(workspace, ".pi", "prompts", "first-project-prompt.md"),
        "utf8",
      ),
    ).toBe("First project prompt\n");
    expect(policy.status()).toEqual({ required: true, trusted: true });
    await expect(service.listPromptResources()).resolves.toEqual([
      expect.objectContaining({
        name: "first-project-prompt",
        editable: true,
        provenance: { scope: "project", origin: "top-level" },
      }),
    ]);
  });

  test.each([
    { scope: "user" as const, decision: "no" as const, trusted: false },
    {
      scope: "temporary" as const,
      decision: "yes" as const,
      trusted: true,
    },
  ])(
    "honors and remembers $scope extension trust decision $decision",
    async ({ scope, decision, trusted }) => {
      const settings = SettingsManager.inMemory(
        { defaultProjectTrust: trusted ? "never" : "always" },
        { projectTrusted: false },
      );
      const store = { get: vi.fn(() => null), set: vi.fn() };
      const handler = vi.fn(() => ({ trusted: decision, remember: true }));
      const policy = new ProjectTrustPolicy(
        "/workspace",
        "/agent",
        settings,
        store,
        () => true,
      );
      const extensions = {
        extensions: [
          {
            sourceInfo: { scope },
            handlers: new Map([["project_trust", [handler]]]),
          },
        ],
        errors: [],
      } as never;

      await expect(policy.refresh(extensions)).resolves.toEqual({
        required: true,
        trusted,
      });

      expect(handler).toHaveBeenCalledWith(
        { type: "project_trust", cwd: "/workspace" },
        expect.objectContaining({
          cwd: "/workspace",
          mode: "rpc",
          hasUI: false,
        }),
      );
      expect(store.set).not.toHaveBeenCalled();
      policy.commitRememberedDecision();
      expect(store.set).toHaveBeenCalledWith("/workspace", trusted);
      expect(settings.isProjectTrusted()).toBe(trusted);
    },
  );

  test("uses an explicit trust override only for its reload window", async () => {
    const settings = SettingsManager.inMemory(
      { defaultProjectTrust: "never" },
      { projectTrusted: false },
    );
    const handler = vi.fn(() => ({ trusted: "no" as const }));
    const policy = new ProjectTrustPolicy(
      "/workspace",
      "/agent",
      settings,
      { get: () => false, set: vi.fn() },
      () => true,
    );
    const extensions = {
      extensions: [
        {
          sourceInfo: { scope: "user" },
          handlers: new Map([["project_trust", [handler]]]),
        },
      ],
      errors: [],
    } as never;

    policy.setResolutionOverride(true);
    await expect(policy.resolveForLoader(extensions)).resolves.toBe(true);
    expect(handler).not.toHaveBeenCalled();

    policy.clearResolutionOverride();
    await expect(policy.resolveForLoader(extensions)).resolves.toBe(false);
    expect(handler).toHaveBeenCalledOnce();
  });

  test("discards an uncommitted remembered extension decision", async () => {
    const settings = SettingsManager.inMemory(
      { defaultProjectTrust: "always" },
      { projectTrusted: true },
    );
    const store = { get: vi.fn(() => true), set: vi.fn() };
    const policy = new ProjectTrustPolicy(
      "/workspace",
      "/agent",
      settings,
      store,
      () => true,
    );
    await policy.refresh({
      extensions: [
        {
          sourceInfo: { scope: "user" },
          handlers: new Map([
            ["project_trust", [() => ({ trusted: "no", remember: true })]],
          ]),
        },
      ],
      errors: [],
    } as never);

    policy.discardRememberedDecision();

    expect(store.set).not.toHaveBeenCalled();
  });

  test("persists a remembered extension denial of manual trust", async () => {
    const settings = SettingsManager.inMemory(
      { defaultProjectTrust: "never" },
      { projectTrusted: false },
    );
    const store = { get: vi.fn(() => null), set: vi.fn() };
    const policy = new ProjectTrustPolicy(
      "/workspace",
      "/agent",
      settings,
      store,
      () => true,
    );
    const extensions = {
      extensions: [
        {
          sourceInfo: { scope: "user" },
          handlers: new Map([
            ["project_trust", [() => ({ trusted: "no", remember: true })]],
          ]),
        },
      ],
      errors: [],
    } as never;

    await expect(policy.assertCanEnable(extensions)).rejects.toThrow(/denied/i);
    expect(store.set).toHaveBeenCalledWith("/workspace", false);
  });

  test("reports a broken trust handler and continues to the next policy", async () => {
    const settings = SettingsManager.inMemory(
      { defaultProjectTrust: "never" },
      { projectTrusted: false },
    );
    const report = vi.fn();
    const policy = new ProjectTrustPolicy(
      "/workspace",
      "/agent",
      settings,
      { get: () => null, set: vi.fn() },
      () => true,
      report,
    );
    const winner = vi.fn(() => ({ trusted: "yes" as const }));

    await expect(
      policy.refresh({
        extensions: [
          {
            path: "/private/broken.js",
            sourceInfo: { scope: "user" },
            handlers: new Map([
              [
                "project_trust",
                [
                  () => {
                    throw new Error("policy failed");
                  },
                  winner,
                ],
              ],
            ]),
          },
        ],
        errors: [],
      } as never),
    ).resolves.toEqual({ required: true, trusted: true });

    expect(report).toHaveBeenCalledWith(
      'Extension "broken.js" project_trust error: policy failed',
    );
    expect(winner).toHaveBeenCalledOnce();
  });

  test("applies a remembered trust denial to proactive enable on a clean project", async () => {
    const settings = SettingsManager.inMemory(
      { defaultProjectTrust: "always" },
      { projectTrusted: false },
    );
    const store = { get: vi.fn(() => null), set: vi.fn() };
    const policy = new ProjectTrustPolicy(
      "/workspace",
      "/agent",
      settings,
      store,
      () => false,
    );
    const handler = vi.fn(() => ({ trusted: "no", remember: true }));

    await expect(
      policy.assertCanEnable({
        extensions: [
          {
            sourceInfo: { scope: "user" },
            handlers: new Map([["project_trust", [handler]]]),
          },
        ],
        errors: [],
      } as never),
    ).rejects.toThrow(/denied/i);

    expect(handler).toHaveBeenCalledOnce();
    expect(store.set).toHaveBeenCalledWith("/workspace", false);
  });

  test("does not allow a project extension to decide its own trust", async () => {
    const settings = SettingsManager.inMemory(
      { defaultProjectTrust: "always" },
      { projectTrusted: false },
    );
    const projectHandler = vi.fn(() => ({
      trusted: "no" as const,
      remember: true,
    }));
    const policy = new ProjectTrustPolicy(
      "/workspace",
      "/agent",
      settings,
      { get: () => null, set: vi.fn() },
      () => true,
    );

    await expect(
      policy.refresh({
        extensions: [
          {
            sourceInfo: { scope: "project" },
            handlers: new Map([["project_trust", [projectHandler]]]),
          },
        ],
        errors: [],
      } as never),
    ).resolves.toEqual({ required: true, trusted: true });
    expect(projectHandler).not.toHaveBeenCalled();
  });

  test("fails closed if gated resources appear after startup", () => {
    let required = false;
    const settings = SettingsManager.inMemory(
      { defaultProjectTrust: "ask" },
      { projectTrusted: false },
    );
    const policy = new ProjectTrustPolicy(
      "/workspace",
      "/agent",
      settings,
      { get: () => null, set: vi.fn() },
      () => required,
    );

    expect(policy.initialize()).toEqual({ required: false, trusted: false });
    expect(settings.isProjectTrusted()).toBe(false);
    required = true;
    expect(policy.status()).toEqual({ required: true, trusted: false });
    expect(policy.initialize()).toEqual({ required: true, trusted: false });
    expect(settings.isProjectTrusted()).toBe(false);
  });

  test("keeps trusted runtime resources disableable after their source is removed", () => {
    let required = true;
    const settings = SettingsManager.inMemory(undefined, {
      projectTrusted: false,
    });
    const policy = new ProjectTrustPolicy(
      "/workspace",
      "/agent",
      settings,
      { get: () => true, set: vi.fn() },
      () => required,
    );

    policy.initialize();
    required = false;
    expect(policy.status()).toEqual({ required: false, trusted: true });
    settings.setProjectTrusted(false);
    expect(policy.status()).toEqual({ required: false, trusted: false });
  });

  test("reports active runtime trust until a changed saved decision is applied", () => {
    let saved = true;
    const settings = SettingsManager.inMemory(undefined, {
      projectTrusted: false,
    });
    const policy = new ProjectTrustPolicy(
      "/workspace",
      "/agent",
      settings,
      { get: () => saved, set: vi.fn() },
      () => true,
    );

    expect(policy.initialize()).toEqual({ required: true, trusted: true });
    saved = false;
    expect(policy.status()).toEqual({ required: true, trusted: true });
    expect(policy.initialize()).toEqual({ required: true, trusted: false });
    expect(policy.status()).toEqual({ required: true, trusted: false });
  });

  test("rolls runtime trust back when synchronized discovery fails", async () => {
    const settings = SettingsManager.inMemory(undefined, {
      projectTrusted: true,
    });
    const rollback = vi.fn(async () => undefined);

    await expect(
      withProjectTrustRollback(
        settings,
        () => settings.setProjectTrusted(false),
        async (changed) => {
          expect(changed).toBe(true);
          throw new Error("discovery failed");
        },
        rollback,
      ),
    ).rejects.toThrow("discovery failed");

    expect(settings.isProjectTrusted()).toBe(true);
    expect(rollback).toHaveBeenCalledOnce();
  });

  test("fails closed when the native trust store cannot be read", () => {
    const settings = SettingsManager.inMemory(
      { defaultProjectTrust: "always" },
      { projectTrusted: false },
    );
    const policy = new ProjectTrustPolicy(
      "/workspace",
      "/agent",
      settings,
      {
        get: () => {
          throw new Error("invalid trust store");
        },
        set: vi.fn(),
      },
      () => true,
    );

    expect(policy.initialize()).toEqual({ required: true, trusted: false });
    expect(settings.isProjectTrusted()).toBe(false);
  });

  test("uses Pi's nearest saved parent decision", async () => {
    const parent = await temporaryDirectory("pi-agent-trust-parent-");
    const workspace = join(parent, "project");
    const agentDir = await temporaryDirectory("pi-agent-trust-store-");
    await mkdir(workspace);
    const store = new ProjectTrustStore(agentDir);
    store.set(parent, true);
    const settings = SettingsManager.inMemory(undefined, {
      projectTrusted: false,
    });
    const policy = new ProjectTrustPolicy(
      workspace,
      agentDir,
      settings,
      store,
      () => true,
    );

    expect(policy.initialize()).toEqual({ required: true, trusted: true });
    policy.persist(false);
    expect(new ProjectTrustStore(agentDir).get(workspace)).toBe(false);
  });
});

describe("Pi project resource loading", () => {
  test("loads and unloads project skills and extensions with native trust", async () => {
    const workspace = await temporaryDirectory("pi-agent-trust-workspace-");
    const agentDir = await temporaryDirectory("pi-agent-trust-agent-");
    const extensionDir = join(workspace, ".pi", "extensions");
    const skillDir = join(workspace, ".pi", "skills", "project-skill");
    await mkdir(extensionDir, { recursive: true });
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(extensionDir, "project.js"),
      'export default function (pi) { pi.registerCommand("project-only", { handler() {} }); }\n',
    );
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: project-skill\ndescription: Project-only instructions\n---\nUse this only after trust.\n",
    );
    const settings = SettingsManager.create(workspace, agentDir, {
      projectTrusted: false,
    });
    const loader = new DefaultResourceLoader({
      cwd: workspace,
      agentDir,
      settingsManager: settings,
    });

    await loader.reload();
    expect(loader.getExtensions().extensions).toEqual([]);
    expect(loader.getSkills().skills).toEqual([]);

    settings.setProjectTrusted(true);
    await loader.reload();
    expect(
      loader
        .getExtensions()
        .extensions.flatMap((extension) => [...extension.commands.keys()]),
    ).toContain("project-only");
    expect(loader.getSkills().skills.map((skill) => skill.name)).toContain(
      "project-skill",
    );

    settings.setProjectTrusted(false);
    await loader.reload();
    expect(loader.getExtensions().extensions).toEqual([]);
    expect(loader.getSkills().skills).toEqual([]);
  });
});
