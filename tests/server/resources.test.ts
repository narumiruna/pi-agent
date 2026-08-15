import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ResourceService } from "../../src/server/resources/service.js";

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
  directories.push(agentDir);
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
  return {
    agentDir,
    reload,
    packages,
    service: new ResourceService(agentDir, packages as never, { reload }),
  };
}

describe("ResourceService", () => {
  test("discovers and atomically edits mounted Pi prompts", async () => {
    const { agentDir, reload, service } = await setup();
    await service.writeDocument("system", undefined, "You are concise.\n");
    await service.writeDocument("template", "review", "Review this.\n");

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
    expect(reload).toHaveBeenCalledTimes(2);
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
    expect(reload).toHaveBeenCalledOnce();
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
    ).rejects.toThrow(/symbolic link/i);
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
      name: "package",
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
