import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DefaultResourceLoader,
  SettingsManager,
  type Skill,
  type SourceInfo,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vitest";
import { opaqueSkillId } from "../../src/server/api-metadata.js";
import {
  ResourceConflictError,
  ResourcePermissionError,
} from "../../src/server/resources/errors.js";
import { ResourceService } from "../../src/server/resources/service.js";
import {
  SkillManager,
  skillSkeleton,
} from "../../src/server/resources/skill-manager.js";
import { MAX_SKILL_FILE_BYTES } from "../../src/server/resources/skill-viewer.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function roots() {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-agent-skill-manager-"));
  const workspace = await mkdtemp(join(tmpdir(), "pi-agent-skill-workspace-"));
  const external = await mkdtemp(join(tmpdir(), "pi-agent-skill-external-"));
  directories.push(agentDir, workspace, external);
  return { agentDir, workspace, external };
}

function sourceInfo(
  path: string,
  overrides: Partial<SourceInfo> = {},
): SourceInfo {
  return {
    path,
    source: "local",
    scope: "user",
    origin: "top-level",
    ...overrides,
  };
}

function nativeSkill(
  filePath: string,
  name: string,
  overrides: Partial<SourceInfo> = {},
): Skill {
  return {
    name,
    description: `${name} description`,
    filePath,
    baseDir: dirname(filePath),
    sourceInfo: sourceInfo(filePath, overrides),
    disableModelInvocation: false,
  };
}

function snapshot(...skills: Skill[]) {
  return { skills, diagnostics: [] };
}

async function writeSkill(path: string, name: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, skillSkeleton(name, `${name} description`));
}

const untrusted = { required: true, trusted: false };
const trusted = { required: true, trusted: true };

describe("SkillManager", () => {
  test("creates standards-shaped user and trusted-project skills without overwriting", async () => {
    const { agentDir, workspace } = await roots();
    const manager = new SkillManager(agentDir, workspace);

    await manager.create(
      snapshot(),
      untrusted,
      "user",
      "review-code",
      " Review code safely ",
    );
    expect(
      await readFile(
        join(agentDir, "skills", "review-code", "SKILL.md"),
        "utf8",
      ),
    ).toBe(skillSkeleton("review-code", "Review code safely"));

    await expect(
      manager.create(
        snapshot(),
        untrusted,
        "user",
        "review-code",
        "Different description",
      ),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    expect(
      await readFile(
        join(agentDir, "skills", "review-code", "SKILL.md"),
        "utf8",
      ),
    ).toBe(skillSkeleton("review-code", "Review code safely"));
    const packageWinner = nativeSkill(
      join(workspace, "package", "SKILL.md"),
      "native-collision",
      { origin: "package" },
    );
    await expect(
      manager.create(
        snapshot(packageWinner),
        untrusted,
        "user",
        "native-collision",
        "Must not shadow Pi's winner",
      ),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    await expect(
      manager.create(snapshot(), untrusted, "user", "../escape", "Unsafe"),
    ).rejects.toThrow(/invalid/i);
    await expect(
      manager.create(snapshot(), untrusted, "user", "safe-name", "   "),
    ).rejects.toThrow(/invalid/i);
    await expect(
      manager.create(snapshot(), untrusted, "user", "a".repeat(65), "Too long"),
    ).rejects.toThrow(/invalid/i);
    await expect(
      manager.create(
        snapshot(),
        untrusted,
        "user",
        "safe-name",
        "x".repeat(1_025),
      ),
    ).rejects.toThrow(/invalid/i);
    await expect(
      manager.create(
        snapshot(),
        untrusted,
        "project",
        "project-skill",
        "Project instructions",
      ),
    ).rejects.toBeInstanceOf(ResourcePermissionError);

    await manager.create(
      snapshot(),
      trusted,
      "project",
      "project-skill",
      "Project instructions",
    );
    expect(
      await readFile(
        join(workspace, ".pi", "skills", "project-skill", "SKILL.md"),
        "utf8",
      ),
    ).toBe(skillSkeleton("project-skill", "Project instructions"));
  });

  test("updates only canonical trusted regular files and rejects stale or unsafe entries", async () => {
    const { agentDir, workspace, external } = await roots();
    const manager = new SkillManager(agentDir, workspace);
    const userEntry = join(agentDir, "skills", "review", "SKILL.md");
    const projectEntry = join(
      workspace,
      ".pi",
      "skills",
      "project",
      "SKILL.md",
    );
    const packageEntry = join(external, "package", "SKILL.md");
    const settingsEntry = join(external, "settings", "SKILL.md");
    const nestedEntry = join(agentDir, "skills", "group", "nested", "SKILL.md");
    await Promise.all([
      writeSkill(userEntry, "review"),
      writeSkill(projectEntry, "project"),
      writeSkill(packageEntry, "packaged"),
      writeSkill(settingsEntry, "configured"),
      writeSkill(nestedEntry, "nested"),
    ]);
    const user = nativeSkill(userEntry, "review");
    const project = nativeSkill(projectEntry, "project", { scope: "project" });
    const packaged = nativeSkill(packageEntry, "packaged", {
      origin: "package",
      source: "npm:@example/skills",
    });
    const configured = nativeSkill(settingsEntry, "configured", {
      baseDir: dirname(settingsEntry),
    });
    const nested = nativeSkill(nestedEntry, "nested");
    const native = snapshot(user, project, packaged, configured, nested);

    await expect(manager.permissions(native, trusted, user)).resolves.toEqual({
      editable: true,
      deletable: true,
    });
    await expect(
      manager.permissions(native, untrusted, project),
    ).resolves.toEqual({ editable: false, deletable: false });
    await expect(
      manager.permissions(native, trusted, packaged),
    ).resolves.toEqual({ editable: false, deletable: false });
    await expect(
      manager.permissions(native, trusted, configured),
    ).resolves.toEqual({ editable: false, deletable: false });
    await expect(manager.permissions(native, trusted, nested)).resolves.toEqual(
      {
        editable: false,
        deletable: false,
      },
    );
    await expect(
      manager.update(
        native,
        trusted,
        opaqueSkillId(nested.sourceInfo),
        "unsafe",
      ),
    ).rejects.toBeInstanceOf(ResourcePermissionError);

    const replacement = skillSkeleton("review", "Updated description");
    await manager.update(
      native,
      trusted,
      opaqueSkillId(user.sourceInfo),
      replacement,
    );
    expect(await readFile(userEntry, "utf8")).toBe(replacement);

    await expect(
      manager.update(
        native,
        trusted,
        opaqueSkillId(user.sourceInfo),
        "x".repeat(MAX_SKILL_FILE_BYTES + 1),
      ),
    ).rejects.toThrow(/too large/i);
    expect(await readFile(userEntry, "utf8")).toBe(replacement);
    await expect(
      manager.update(native, trusted, "skill_stale", "replacement"),
    ).rejects.toThrow(/not found/i);
    await expect(
      manager.update(
        native,
        untrusted,
        opaqueSkillId(project.sourceInfo),
        "replacement",
      ),
    ).rejects.toBeInstanceOf(ResourcePermissionError);

    const hardEntry = join(agentDir, "skills", "hard", "SKILL.md");
    const hardTarget = join(external, "hard-target.md");
    await mkdir(dirname(hardEntry), { recursive: true });
    await writeSkill(hardTarget, "hard");
    await link(hardTarget, hardEntry);
    const hard = nativeSkill(hardEntry, "hard");
    await expect(
      manager.update(
        snapshot(hard),
        trusted,
        opaqueSkillId(hard.sourceInfo),
        "unsafe",
      ),
    ).rejects.toBeInstanceOf(ResourcePermissionError);
    expect(await readFile(hardTarget, "utf8")).toBe(
      skillSkeleton("hard", "hard description"),
    );

    const linkedEntry = join(agentDir, "skills", "linked", "SKILL.md");
    const linkedTarget = join(external, "linked-target.md");
    await mkdir(dirname(linkedEntry), { recursive: true });
    await writeSkill(linkedTarget, "linked");
    await symlink(linkedTarget, linkedEntry);
    const linked = nativeSkill(linkedEntry, "linked");
    await expect(
      manager.update(
        snapshot(linked),
        trusted,
        opaqueSkillId(linked.sourceInfo),
        "unsafe",
      ),
    ).rejects.toBeInstanceOf(ResourcePermissionError);
    expect(await readFile(linkedTarget, "utf8")).toBe(
      skillSkeleton("linked", "linked description"),
    );
  });

  test("deletes only the selected direct file or quarantined skill directory", async () => {
    const { agentDir, workspace, external } = await roots();
    const manager = new SkillManager(agentDir, workspace);
    const direct = join(agentDir, "skills", "direct.md");
    const directSibling = join(agentDir, "skills", "sibling.md");
    await writeSkill(direct, "direct");
    await writeSkill(directSibling, "sibling");
    const directSkill = nativeSkill(direct, "direct");
    await manager.delete(
      snapshot(directSkill),
      trusted,
      opaqueSkillId(directSkill.sourceInfo),
    );
    await expect(readFile(direct, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(directSibling, "utf8")).resolves.toContain(
      "name: sibling",
    );

    const directoryEntry = join(agentDir, "skills", "directory", "SKILL.md");
    const siblingEntry = join(agentDir, "skills", "kept", "SKILL.md");
    const outside = join(external, "outside.txt");
    await Promise.all([
      writeSkill(directoryEntry, "directory"),
      writeSkill(siblingEntry, "kept"),
      writeFile(outside, "outside\n"),
    ]);
    await mkdir(join(dirname(directoryEntry), "references"));
    await writeFile(
      join(dirname(directoryEntry), "references", "guide.md"),
      "guide\n",
    );
    await symlink(outside, join(dirname(directoryEntry), "outside-link"));
    const directorySkill = nativeSkill(directoryEntry, "directory");
    await manager.delete(
      snapshot(directorySkill),
      trusted,
      opaqueSkillId(directorySkill.sourceInfo),
    );
    await expect(readFile(directoryEntry, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(siblingEntry, "utf8")).resolves.toContain(
      "name: kept",
    );
    await expect(readFile(outside, "utf8")).resolves.toBe("outside\n");

    const packageEntry = join(workspace, "package", "SKILL.md");
    await writeSkill(packageEntry, "package");
    const packaged = nativeSkill(packageEntry, "package", {
      origin: "package",
    });
    await expect(
      manager.delete(
        snapshot(packaged),
        trusted,
        opaqueSkillId(packaged.sourceInfo),
      ),
    ).rejects.toBeInstanceOf(ResourcePermissionError);
  });

  test("fails closed when a canonical skill root is replaced by a symlink", async () => {
    const { agentDir, workspace, external } = await roots();
    const manager = new SkillManager(agentDir, workspace);
    const externalSkills = join(external, "skills");
    await mkdir(externalSkills);
    await symlink(externalSkills, join(agentDir, "skills"));

    await expect(
      manager.create(snapshot(), trusted, "user", "review", "Review safely"),
    ).rejects.toBeInstanceOf(ResourcePermissionError);
    await expect(
      readFile(join(externalSkills, "review", "SKILL.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("Skill resource lifecycle", () => {
  test("runs create, update, and delete through native maintenance reloads", async () => {
    const { agentDir, workspace } = await roots();
    const settings = SettingsManager.create(workspace, agentDir, {
      projectTrusted: false,
    });
    const loader = new DefaultResourceLoader({
      cwd: workspace,
      agentDir,
      settingsManager: settings,
    });
    const reload = vi.fn(async () => loader.reload());
    const runtime = {
      reload,
      mutateResources: async <T>(operation: () => Promise<T>): Promise<T> => {
        await reload();
        const result = await operation();
        await reload();
        return result;
      },
      projectTrust: () => ({ required: false, trusted: false }),
      promptDiagnostics: () => loader.getPrompts().diagnostics,
      promptTemplates: () => loader.getPrompts().prompts,
      skillCommandsEnabled: () => true,
      skillSnapshot: () => loader.getSkills(),
    };
    const packages = {
      installAndPersist: async () => undefined,
      listConfiguredPackages: () => [],
      removeAndPersist: async () => false,
      update: async () => undefined,
    };
    await loader.reload();
    const service = new ResourceService(
      agentDir,
      workspace,
      packages as never,
      runtime,
    );

    await service.createSkill("user", "review", "Review code");
    let inventory = await service.listSkillInventory();
    expect(inventory.skills).toEqual([
      expect.objectContaining({
        name: "review",
        editable: true,
        deletable: true,
        commandEnabled: true,
        modelInvocationEnabled: true,
      }),
    ]);
    const id = inventory.skills[0]?.id;
    expect(id).toBeDefined();

    await service.updateSkill(
      id ?? "",
      skillSkeleton("review", "Updated review"),
    );
    inventory = await service.listSkillInventory();
    expect(inventory.skills[0]?.description).toBe("Updated review");

    await service.deleteSkill(id ?? "");
    await expect(service.listSkillInventory()).resolves.toEqual(
      expect.objectContaining({ skills: [] }),
    );
    expect(reload).toHaveBeenCalledTimes(6);
  });
});
