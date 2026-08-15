import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DefaultResourceLoader,
  ProjectTrustStore,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ProjectTrustPolicy } from "../../src/server/agent/project-trust.js";

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
    expect(settings.isProjectTrusted()).toBe(required && trusted);
    expect(store.get).toHaveBeenCalledTimes(required ? 1 : 0);
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

    expect(policy.initialize()).toEqual({ required: false, trusted: true });
    expect(settings.isProjectTrusted()).toBe(false);
    required = true;
    expect(policy.status()).toEqual({ required: true, trusted: false });
    expect(policy.initialize()).toEqual({ required: true, trusted: false });
    expect(settings.isProjectTrusted()).toBe(false);
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
