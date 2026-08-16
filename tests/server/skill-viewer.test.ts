import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DefaultResourceLoader,
  type ResourceDiagnostic,
  SettingsManager,
  type Skill,
  type SourceInfo,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test } from "vitest";
import { opaqueSkillId } from "../../src/server/api-metadata.js";
import {
  MAX_SKILL_FILE_BYTES,
  parseSkillFilePath,
  SkillViewer,
} from "../../src/server/resources/skill-viewer.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function roots() {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-agent-skill-agent-"));
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

function skill(
  filePath: string,
  name: string,
  info = sourceInfo(filePath),
): Skill {
  return {
    name,
    description: `${name} description`,
    filePath,
    baseDir: dirname(filePath),
    sourceInfo: info,
    disableModelInvocation: false,
  };
}

async function writeSkill(filePath: string, name: string) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `---\nname: ${name}\ndescription: ${name} description\n---\n\n# ${name}\n`,
  );
}

describe("SkillViewer", () => {
  test("uses Pi's native winners and validation diagnostics as its catalog", async () => {
    const { agentDir, workspace } = await roots();
    const validEntry = join(agentDir, "skills", "valid", "SKILL.md");
    const omittedEntry = join(agentDir, "skills", "omitted", "SKILL.md");
    await writeSkill(validEntry, "valid");
    await mkdir(dirname(omittedEntry), { recursive: true });
    await writeFile(omittedEntry, "---\nname: omitted\n---\nNo description\n");
    const loader = new DefaultResourceLoader({
      cwd: workspace,
      agentDir,
      settingsManager: SettingsManager.create(workspace, agentDir, {
        projectTrusted: false,
      }),
    });
    await loader.reload();
    const snapshot = loader.getSkills();
    const viewer = new SkillViewer(agentDir, workspace);

    expect(snapshot.skills.map(({ name }) => name)).toEqual(["valid"]);
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        type: "warning",
        message: "description is required",
        path: omittedEntry,
      }),
    ]);
    await expect(
      viewer.inventory(snapshot, { required: false, trusted: false }),
    ).resolves.toEqual(
      expect.objectContaining({
        skills: [
          expect.objectContaining({
            name: "valid",
            path: "~/.pi/agent/skills/valid/SKILL.md",
          }),
        ],
        diagnostics: [
          expect.objectContaining({
            message: "description is required",
            path: "~/.pi/agent/skills/omitted/SKILL.md",
          }),
        ],
      }),
    );
  });

  test("projects native scopes, sources, diagnostics, and bounded file metadata", async () => {
    const { agentDir, workspace, external } = await roots();
    const userEntry = join(agentDir, "skills", "global", "SKILL.md");
    const projectEntry = join(
      workspace,
      ".pi",
      "skills",
      "project",
      "SKILL.md",
    );
    const agentsEntry = join(
      external,
      ".agents",
      "skills",
      "portable",
      "SKILL.md",
    );
    const packageRoot = join(external, "package");
    const packageEntry = join(packageRoot, "skills", "packaged", "SKILL.md");
    const settingsEntry = join(
      external,
      "configured",
      "settings-skill",
      "SKILL.md",
    );
    const temporaryEntry = join(
      external,
      "temporary",
      "temporary-skill",
      "SKILL.md",
    );
    await Promise.all([
      writeSkill(userEntry, "global"),
      writeSkill(projectEntry, "project"),
      writeSkill(agentsEntry, "portable"),
      writeSkill(packageEntry, "packaged"),
      writeSkill(settingsEntry, "settings-skill"),
      writeSkill(temporaryEntry, "temporary-skill"),
    ]);
    await mkdir(join(dirname(userEntry), "references"), { recursive: true });
    await mkdir(join(dirname(userEntry), "scripts"), { recursive: true });
    await mkdir(join(dirname(userEntry), "assets"), { recursive: true });
    await writeFile(
      join(dirname(userEntry), "references", "guide.md"),
      "Reference guide\n",
    );
    await writeFile(
      join(dirname(userEntry), "scripts", "run.sh"),
      "#!/bin/sh\necho safe\n",
    );
    await writeFile(
      join(dirname(userEntry), "assets", "image.bin"),
      Buffer.from([0, 1, 2, 3]),
    );
    await writeFile(
      join(dirname(userEntry), "assets", "large.txt"),
      "x".repeat(MAX_SKILL_FILE_BYTES + 1),
    );
    const linkedTarget = join(external, "outside.txt");
    await writeFile(linkedTarget, "outside\n");
    await symlink(
      linkedTarget,
      join(dirname(userEntry), "assets", "linked.txt"),
    );
    const hardTarget = join(dirname(userEntry), "assets", "hard-target.txt");
    await writeFile(hardTarget, "hard linked\n");
    await link(
      hardTarget,
      join(dirname(userEntry), "assets", "hard-alias.txt"),
    );

    const skills = [
      skill(userEntry, "global"),
      skill(
        projectEntry,
        "project",
        sourceInfo(projectEntry, { scope: "project" }),
      ),
      skill(
        agentsEntry,
        "portable",
        sourceInfo(agentsEntry, { source: "auto" }),
      ),
      skill(
        packageEntry,
        "packaged",
        sourceInfo(packageEntry, {
          source: "npm:@example/skills@1.0.0",
          origin: "package",
          baseDir: packageRoot,
        }),
      ),
      skill(
        settingsEntry,
        "settings-skill",
        sourceInfo(settingsEntry, { baseDir: dirname(settingsEntry) }),
      ),
      skill(
        temporaryEntry,
        "temporary-skill",
        sourceInfo(temporaryEntry, {
          source: "cli",
          scope: "temporary",
          baseDir: dirname(temporaryEntry),
        }),
      ),
    ];
    const diagnostics: ResourceDiagnostic[] = [
      {
        type: "warning",
        message: "name contains invalid characters",
        path: userEntry,
      },
      {
        type: "warning",
        message: "description is required",
        path: join(agentDir, "skills", "omitted", "SKILL.md"),
      },
    ];
    const viewer = new SkillViewer(agentDir, workspace);

    const inventory = await viewer.inventory(
      { skills, diagnostics },
      { required: true, trusted: true },
    );

    expect(
      inventory.skills.map(({ name, provenance, source, path }) => ({
        name,
        provenance,
        source,
        path,
      })),
    ).toEqual([
      {
        name: "global",
        provenance: { scope: "user", origin: "top-level" },
        source: "local",
        path: "~/.pi/agent/skills/global/SKILL.md",
      },
      {
        name: "project",
        provenance: { scope: "project", origin: "top-level" },
        source: "local",
        path: ".pi/skills/project/SKILL.md",
      },
      {
        name: "portable",
        provenance: { scope: "user", origin: "top-level" },
        source: "local",
        path: "~/.agents/skills/portable/SKILL.md",
      },
      {
        name: "packaged",
        provenance: { scope: "user", origin: "package" },
        source: "@example/skills@1.0.0",
        path: "packages/@example/skills@1.0.0/skills/packaged/SKILL.md",
      },
      {
        name: "settings-skill",
        provenance: { scope: "user", origin: "top-level" },
        source: "settings",
        path: "settings/settings-skill/SKILL.md",
      },
      {
        name: "temporary-skill",
        provenance: { scope: "temporary", origin: "top-level" },
        source: "CLI",
        path: "temporary/temporary-skill/SKILL.md",
      },
    ]);
    expect(inventory.skillCommandsEnabled).toBe(true);
    expect(
      inventory.skills.map(({ editable, deletable }) => ({
        editable,
        deletable,
      })),
    ).toEqual([
      { editable: true, deletable: true },
      { editable: true, deletable: true },
      { editable: false, deletable: false },
      { editable: false, deletable: false },
      { editable: false, deletable: false },
      { editable: false, deletable: false },
    ]);
    expect(
      inventory.skills.every(
        ({ commandEnabled, modelInvocationEnabled }) =>
          commandEnabled && modelInvocationEnabled,
      ),
    ).toBe(true);
    expect(inventory.skills[0]?.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "SKILL.md",
          kind: "text",
          entry: true,
        }),
        expect.objectContaining({
          path: "references/guide.md",
          kind: "text",
        }),
        expect.objectContaining({ path: "scripts/run.sh", kind: "text" }),
        expect.objectContaining({ path: "assets/image.bin", kind: "binary" }),
        expect.objectContaining({
          path: "assets/large.txt",
          kind: "too_large",
        }),
        expect.objectContaining({
          path: "assets/linked.txt",
          kind: "unavailable",
        }),
        expect.objectContaining({
          path: "assets/hard-alias.txt",
          kind: "unavailable",
        }),
        expect.objectContaining({
          path: "assets/hard-target.txt",
          kind: "unavailable",
        }),
      ]),
    );
    expect(inventory.diagnostics).toEqual([
      {
        severity: "warning",
        message: "name contains invalid characters",
        path: "~/.pi/agent/skills/global/SKILL.md",
        skillId: opaqueSkillId(skills[0]?.sourceInfo ?? sourceInfo(userEntry)),
      },
      {
        severity: "warning",
        message: "description is required",
        path: "~/.pi/agent/skills/omitted/SKILL.md",
      },
    ]);
    expect(JSON.stringify(inventory)).not.toContain(agentDir);
    expect(JSON.stringify(inventory)).not.toContain(workspace);
    expect(JSON.stringify(inventory)).not.toContain(external);

    if (skills[0]) skills[0].disableModelInvocation = true;
    const disabled = await viewer.inventory(
      { skills, diagnostics },
      { required: true, trusted: true },
      false,
    );
    expect(disabled.skillCommandsEnabled).toBe(false);
    expect(disabled.skills[0]).toEqual(
      expect.objectContaining({
        commandEnabled: false,
        modelInvocationEnabled: false,
      }),
    );
  });

  test("bounds directory traversal without dropping the entry file", async () => {
    const { agentDir, workspace } = await roots();
    const entry = join(agentDir, "skills", "bounded", "SKILL.md");
    await writeSkill(entry, "bounded");
    await Promise.all(
      Array.from({ length: 510 }, (_, index) =>
        writeFile(
          join(dirname(entry), `file-${String(index).padStart(3, "0")}.txt`),
          "x",
        ),
      ),
    );
    const native = skill(entry, "bounded");
    const viewer = new SkillViewer(agentDir, workspace);

    const inventory = await viewer.inventory(
      { skills: [native], diagnostics: [] },
      { required: false, trusted: false },
    );

    expect(inventory.skills[0]?.filesTruncated).toBe(true);
    expect(inventory.skills[0]?.files).toHaveLength(500);
    expect(inventory.skills[0]?.files[0]).toEqual(
      expect.objectContaining({ path: "SKILL.md", entry: true }),
    );
  });

  test("limits a direct Markdown skill to its native entry file", async () => {
    const { agentDir, workspace } = await roots();
    const root = join(agentDir, "skills");
    const entry = join(root, "direct.md");
    await mkdir(root, { recursive: true });
    await writeFile(entry, "Direct instructions\n");
    await writeFile(join(root, "sibling-secret.md"), "Do not expose\n");
    const native = skill(entry, "direct");
    const viewer = new SkillViewer(agentDir, workspace);

    const inventory = await viewer.inventory(
      { skills: [native], diagnostics: [] },
      { required: false, trusted: false },
    );

    expect(inventory.skills[0]?.files).toEqual([
      { path: "direct.md", size: 20, kind: "text", entry: true },
    ]);
    await expect(
      viewer.readFile(
        { skills: [native], diagnostics: [] },
        opaqueSkillId(native.sourceInfo),
        "sibling-secret.md",
      ),
    ).rejects.toThrow(/not found/i);
  });

  test("reads only enumerated UTF-8 text and fails closed for unsafe paths", async () => {
    const { agentDir, workspace, external } = await roots();
    const entry = join(agentDir, "skills", "viewer", "SKILL.md");
    await writeSkill(entry, "viewer");
    const root = dirname(entry);
    await writeFile(join(root, "text.txt"), "Readable text\n");
    await writeFile(join(root, "binary.dat"), Buffer.from([65, 0, 66]));
    await writeFile(
      join(root, "large.txt"),
      "x".repeat(MAX_SKILL_FILE_BYTES + 1),
    );
    const outside = join(external, "outside.txt");
    await writeFile(outside, "outside\n");
    await symlink(outside, join(root, "linked.txt"));
    const native = skill(entry, "viewer");
    const snapshot = { skills: [native], diagnostics: [] };
    const id = opaqueSkillId(native.sourceInfo);
    const viewer = new SkillViewer(agentDir, workspace);

    await expect(viewer.readFile(snapshot, id, "text.txt")).resolves.toEqual({
      path: "text.txt",
      size: 14,
      kind: "text",
      content: "Readable text\n",
    });
    await expect(viewer.readFile(snapshot, id, "binary.dat")).resolves.toEqual({
      path: "binary.dat",
      size: 3,
      kind: "binary",
    });
    await expect(viewer.readFile(snapshot, id, "large.txt")).resolves.toEqual({
      path: "large.txt",
      size: MAX_SKILL_FILE_BYTES + 1,
      kind: "too_large",
    });
    await expect(viewer.readFile(snapshot, id, "linked.txt")).resolves.toEqual(
      expect.objectContaining({ path: "linked.txt", kind: "unavailable" }),
    );
    for (const path of ["../outside.txt", "/etc/passwd", "nested\\file"])
      await expect(viewer.readFile(snapshot, id, path)).rejects.toThrow(
        /invalid/i,
      );
    await expect(
      viewer.readFile(snapshot, "skill_stale", "SKILL.md"),
    ).rejects.toThrow(/not found/i);
  });

  test.each(["", ".", "..", "../file", "/file", "nested\\file", "bad\0file"])(
    "rejects unsafe relative path %j",
    (path) => {
      expect(() => parseSkillFilePath(path)).toThrow(/invalid/i);
    },
  );
});
