import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { WorkspaceError } from "../../src/server/workspace/errors.js";
import {
  createOperationGuard,
  createWorkspaceBoundary,
  isPathContained,
  parseWorkspaceBasename,
  parseWorkspacePath,
  resolveWorkspaceParent,
  resolveWorkspaceTarget,
} from "../../src/server/workspace/policy.js";
import { searchWorkspace } from "../../src/server/workspace/search.js";
import {
  MAX_WORKSPACE_DIRECTORY_ENTRIES,
  MAX_WORKSPACE_DOWNLOAD_BYTES,
  MAX_WORKSPACE_TEXT_BYTES,
  WorkspaceService,
} from "../../src/server/workspace/service.js";

const cleanups: string[] = [];

async function temporaryWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-workspace-"));
  cleanups.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    cleanups
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("workspace path policy", () => {
  test("bounds unresolved awaited operations and reacts to aborts", async () => {
    vi.useFakeTimers();
    try {
      const timeoutGuard = createOperationGuard(undefined, 25);
      const timedOut = timeoutGuard.run(
        () => new Promise<never>(() => undefined),
      );
      const timeoutAssertion = expect(timedOut).rejects.toMatchObject({
        status: 400,
        reason: "cancelled",
      });

      await vi.advanceTimersByTimeAsync(25);
      await timeoutAssertion;

      const controller = new AbortController();
      const abortGuard = createOperationGuard(controller.signal, 1_000);
      const aborted = abortGuard.run(() => new Promise<never>(() => undefined));
      const abortAssertion = expect(aborted).rejects.toMatchObject({
        name: "AbortError",
      });
      controller.abort();
      await abortAssertion;
    } finally {
      vi.useRealTimers();
    }
  });

  test("accepts canonical Unicode paths and rejects aliases and private names", () => {
    expect(parseWorkspacePath("src/繁體中文.ts")).toBe("src/繁體中文.ts");
    expect(parseWorkspacePath("")).toBe("");
    for (const path of [
      "../outside",
      "src/../outside",
      "/absolute",
      "C:/absolute",
      "src\\file.ts",
      "src//file.ts",
      "src/./file.ts",
      "file\0name",
      "x".repeat(1_025),
    ]) {
      expect(() => parseWorkspacePath(path)).toThrow(WorkspaceError);
    }
    for (const name of [
      ".",
      "..",
      ".env",
      ".envrc",
      ".git-credentials",
      ".npmrc",
      ".pypirc",
      ".netrc",
      "private.pem",
      "private.key",
      "secrets.json",
      "node_modules",
      "nested/name",
      "line\nbreak",
    ]) {
      expect(() => parseWorkspaceBasename(name)).toThrow(WorkspaceError);
    }
  });

  test("canonicalizes a symlinked workspace root before resolving targets", async () => {
    const root = await temporaryWorkspace();
    const links = await temporaryWorkspace();
    await mkdir(join(root, "src"));
    await mkdir(join(root, "private"));
    await writeFile(join(root, "src", "index.ts"), "export {};");
    const workspaceLink = join(links, "workspace");
    await symlink(root, workspaceLink);

    const boundary = await createWorkspaceBoundary(workspaceLink, [
      join(workspaceLink, "private"),
    ]);
    const target = await resolveWorkspaceTarget(
      boundary,
      "src/index.ts",
      "file",
    );
    const destination = await resolveWorkspaceParent(
      boundary,
      "src/new-file.ts",
    );

    expect(boundary.root).toBe(await realpath(root));
    expect(target).toMatchObject({ path: "src/index.ts" });
    expect(target.absolute).toBe(await realpath(join(root, "src", "index.ts")));
    expect(destination).toMatchObject({ path: "src/new-file.ts" });
    expect(destination.parent.path).toBe("src");
    expect(isPathContained(boundary.root, target.absolute)).toBe(true);
    expect(isPathContained(boundary.root, destination.absolute)).toBe(true);
    expect(isPathContained(boundary.root, links)).toBe(false);
    await expect(
      resolveWorkspaceTarget(boundary, "private", "directory"),
    ).rejects.toMatchObject({ status: 404, reason: "not_found" });
  });

  test("rejects nested symlink targets and mutation parents", async () => {
    const root = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    await mkdir(join(root, "nested"));
    await writeFile(join(outside, "secret.txt"), "outside");
    await symlink(outside, join(root, "nested", "escape"));
    const boundary = await createWorkspaceBoundary(root);

    await expect(
      resolveWorkspaceTarget(boundary, "nested/escape/secret.txt", "file"),
    ).rejects.toMatchObject({ status: 404, reason: "not_found" });
    await expect(
      resolveWorkspaceParent(boundary, "nested/escape/new.txt"),
    ).rejects.toMatchObject({ status: 404, reason: "not_found" });
  });
});

describe("workspace file search", () => {
  test("returns bounded relative matches and skips secrets and symlinks", async () => {
    const root = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await mkdir(join(root, "custom-agent-data"));
    await writeFile(join(root, "src", "api-client.ts"), "export {};");
    await writeFile(join(root, ".env"), "SECRET=value");
    await writeFile(join(root, ".npmrc"), "token=value");
    await writeFile(join(root, "auth.json"), "{}");
    await writeFile(join(root, "node_modules", "api-secret.ts"), "secret");
    await writeFile(
      join(root, "custom-agent-data", "api-session.jsonl"),
      "secret",
    );
    await writeFile(join(outside, "api-outside.ts"), "outside");
    await symlink(outside, join(root, "outside"));

    await expect(
      searchWorkspace(root, "api", {
        excludePaths: [join(root, "custom-agent-data")],
        limit: 500,
      }),
    ).resolves.toEqual([{ path: "src/api-client.ts", directory: false }]);
    expect(await searchWorkspace(root, "env")).toEqual([]);
    expect(await searchWorkspace(root, "npm")).toEqual([]);
    expect(await searchWorkspace(root, "outside")).toEqual([]);
  });

  test("supports fuzzy matching, result limits, directories, and aborts", async () => {
    const root = await temporaryWorkspace();
    await mkdir(join(root, "source"));
    await writeFile(join(root, "source", "conversation-panel.tsx"), "");
    await Promise.all(
      Array.from({ length: 60 }, (_, index) =>
        writeFile(join(root, "source", `match-${index}.ts`), ""),
      ),
    );

    expect(await searchWorkspace(root, "cvpnl", { limit: 1 })).toEqual([
      { path: "source/conversation-panel.tsx", directory: false },
    ]);
    expect(await searchWorkspace(root, "source", { limit: 10 })).toContainEqual(
      { path: "source", directory: true },
    );
    expect(await searchWorkspace(root, "match", { limit: 10 })).toHaveLength(
      10,
    );
    const abort = new AbortController();
    abort.abort(new DOMException("cancelled", "AbortError"));
    await expect(
      searchWorkspace(root, "source", { signal: abort.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("workspace service", () => {
  test("lists safe entries lazily with bounded relative metadata", async () => {
    const root = await temporaryWorkspace();
    const agentDir = join(root, "private-agent");
    await mkdir(join(root, "src"));
    await mkdir(agentDir);
    await writeFile(join(root, "README.md"), "read me");
    await writeFile(join(root, "src", "繁體中文.ts"), "export {};");
    await writeFile(join(root, "src", "CaseSensitive.ts"), "export {};");
    await writeFile(join(root, ".env.local"), "SECRET=value");
    await writeFile(join(agentDir, "session.jsonl"), "private");
    await symlink(join(root, "src"), join(root, "linked-src"));
    await symlink(join(root, "README.md"), join(root, "linked-file"));
    const service = new WorkspaceService(root, [agentDir]);

    const listing = await service.listDirectory("");

    expect(listing.path).toBe("");
    expect(listing.entries.map((entry) => entry.path)).toEqual([
      "src",
      "README.md",
    ]);
    expect(listing.entries[0]).toMatchObject({
      kind: "directory",
      name: "src",
    });
    expect(JSON.stringify(listing)).not.toContain(root);
    const nested = await service.listDirectory("src");
    expect(nested.entries).toEqual(
      expect.arrayContaining([
        {
          path: "src/CaseSensitive.ts",
          name: "CaseSensitive.ts",
          kind: "file",
          modifiedAt: expect.any(Number),
          size: 10,
        },
        {
          path: "src/繁體中文.ts",
          name: "繁體中文.ts",
          kind: "file",
          modifiedAt: expect.any(Number),
          size: 10,
        },
      ]),
    );
    await expect(service.listDirectory("../outside")).rejects.toMatchObject({
      reason: "invalid_path",
    });
    await expect(service.listDirectory("linked-src")).rejects.toMatchObject({
      reason: "not_found",
    });
    await expect(service.inspectFile("linked-file")).rejects.toMatchObject({
      reason: "not_found",
    });
    await expect(service.listDirectory("private-agent")).rejects.toMatchObject({
      reason: "not_found",
    });
  });

  test("rejects symlink escapes across every public path operation", async () => {
    const root = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    await mkdir(join(root, "safe"));
    await writeFile(join(root, "safe", "source.txt"), "source");
    await writeFile(join(outside, "victim.txt"), "outside");
    await symlink(outside, join(root, "safe", "escape"));
    const service = new WorkspaceService(root);
    const escapingPath = "safe/escape/victim.txt";

    const rejectedOperations: Array<() => Promise<unknown>> = [
      () => service.listDirectory("safe/escape"),
      () => service.inspectFile(escapingPath),
      () =>
        service.writeFile({
          path: "safe/escape/new.txt",
          content: "created",
        }),
      () =>
        service.writeFile({
          path: escapingPath,
          content: "updated",
          revision: "untrusted-revision",
        }),
      () =>
        service.renameFile({
          path: escapingPath,
          name: "renamed.txt",
          revision: "untrusted-revision",
        }),
      () =>
        service.deleteFile({
          path: escapingPath,
          revision: "untrusted-revision",
        }),
      () => service.downloadFile(escapingPath),
    ];
    for (const operation of rejectedOperations) {
      await expect(operation()).rejects.toMatchObject({
        status: 404,
        reason: "not_found",
      });
    }

    const source = await service.inspectFile("safe/source.txt");
    await expect(
      service.renameFile({
        path: source.path,
        name: "escape",
        revision: source.revision,
      }),
    ).rejects.toMatchObject({ status: 409, reason: "exists" });
    await expect(searchWorkspace(root, "victim")).resolves.toEqual([]);
    await expect(service.listDirectory("safe")).resolves.toMatchObject({
      entries: [expect.objectContaining({ path: "safe/source.txt" })],
    });
    expect(await readFile(join(outside, "victim.txt"), "utf8")).toBe("outside");
    await expect(readFile(join(outside, "new.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("truncates oversized directories without exposing internal temp files", async () => {
    const root = await temporaryWorkspace();
    await Promise.all(
      Array.from({ length: MAX_WORKSPACE_DIRECTORY_ENTRIES + 1 }, (_, index) =>
        writeFile(join(root, `file-${String(index).padStart(3, "0")}.txt`), ""),
      ),
    );
    await writeFile(join(root, ".pi-agent-private.tmp"), "temporary");
    const listing = await new WorkspaceService(root).listDirectory("");

    expect(listing.entries).toHaveLength(MAX_WORKSPACE_DIRECTORY_ENTRIES);
    expect(listing.truncated).toBe(true);
    expect(
      listing.entries.some((entry) => entry.name.includes("pi-agent")),
    ).toBe(false);
  });

  test("previews UTF-8 and classifies binary, invalid, oversized, and unsupported files", async () => {
    const root = await temporaryWorkspace();
    await writeFile(join(root, "text.txt"), "Hello, 世界\n");
    await writeFile(join(root, "binary.bin"), Buffer.from([1, 0, 2]));
    await writeFile(join(root, "invalid.txt"), Buffer.from([0xff, 0xfe]));
    await writeFile(
      join(root, "bom.txt"),
      Buffer.from([0xef, 0xbb, 0xbf, 0x74, 0x65, 0x78, 0x74]),
    );
    const oversized = await open(join(root, "large.txt"), "w");
    await oversized.truncate(MAX_WORKSPACE_TEXT_BYTES + 1);
    await oversized.close();
    await mkdir(join(root, "folder"));
    const service = new WorkspaceService(root);

    const text = await service.inspectFile("text.txt");
    expect(text).toMatchObject({
      path: "text.txt",
      name: "text.txt",
      content: "Hello, 世界\n",
      editable: true,
      writable: true,
    });
    expect(text.revision).not.toContain(root);
    await expect(service.inspectFile("binary.bin")).resolves.toMatchObject({
      editable: false,
      reason: "binary",
    });
    await expect(service.inspectFile("invalid.txt")).resolves.toMatchObject({
      editable: false,
      reason: "binary",
    });
    await expect(service.inspectFile("bom.txt")).resolves.toMatchObject({
      content: "\ufefftext",
      editable: true,
    });
    await expect(service.inspectFile("large.txt")).resolves.toMatchObject({
      editable: false,
      reason: "too_large",
      size: MAX_WORKSPACE_TEXT_BYTES + 1,
    });
    await expect(service.inspectFile("folder")).rejects.toMatchObject({
      status: 415,
      reason: "unsupported",
    });
  });

  test("creates and atomically updates files without stale overwrites", async () => {
    const root = await temporaryWorkspace();
    const service = new WorkspaceService(root);

    await expect(
      service.writeFile({ path: "missing/file.txt", content: "content" }),
    ).rejects.toMatchObject({ status: 404, reason: "not_found" });
    const created = await service.writeFile({
      path: "created.txt",
      content: "first",
    });
    expect(created.content).toBe("first");
    await expect(
      service.writeFile({ path: "created.txt", content: "duplicate" }),
    ).rejects.toMatchObject({ status: 409, reason: "exists" });
    await expect(
      service.writeFile({ path: "binary.txt", content: "text\0binary" }),
    ).rejects.toMatchObject({ status: 415, reason: "binary" });

    await chmod(join(root, "created.txt"), 0o660);
    const current = await service.inspectFile("created.txt");
    const updated = await service.writeFile({
      path: "created.txt",
      content: "second",
      revision: current.revision,
    });
    expect(updated.content).toBe("second");
    expect((await stat(join(root, "created.txt"))).mode & 0o777).toBe(0o660);

    await writeFile(join(root, "created.txt"), "external");
    await expect(
      service.writeFile({
        path: "created.txt",
        content: "stale",
        revision: updated.revision,
      }),
    ).rejects.toMatchObject({ status: 409, reason: "stale" });
    expect(await readFile(join(root, "created.txt"), "utf8")).toBe("external");
    expect(
      (await readdir(root)).filter((name) => name.startsWith(".pi-agent-")),
    ).toEqual([]);
  });

  test("reports read-only directories without leaving temporary files", async () => {
    const root = await temporaryWorkspace();
    const directory = join(root, "read-only");
    await mkdir(directory);
    await chmod(directory, 0o555);
    const service = new WorkspaceService(root);

    try {
      if (process.getuid?.() === 0) return;
      await expect(service.listDirectory("read-only")).resolves.toMatchObject({
        writable: false,
      });
      await expect(
        service.writeFile({ path: "read-only/file.txt", content: "content" }),
      ).rejects.toMatchObject({ status: 403, reason: "read_only" });
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await chmod(directory, 0o755);
    }
  });

  test("serializes concurrent updates so only one revision wins", async () => {
    const root = await temporaryWorkspace();
    const service = new WorkspaceService(root);
    const initial = await service.writeFile({ path: "race.txt", content: "0" });

    const results = await Promise.allSettled([
      service.writeFile({
        path: "race.txt",
        content: "1",
        revision: initial.revision,
      }),
      service.writeFile({
        path: "race.txt",
        content: "2",
        revision: initial.revision,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { reason: "stale" } });
  });

  test("renames without replacing and deletes only the observed revision", async () => {
    const root = await temporaryWorkspace();
    await writeFile(join(root, "source.txt"), "source");
    await writeFile(join(root, "occupied.txt"), "occupied");
    const service = new WorkspaceService(root);
    const source = await service.inspectFile("source.txt");

    await expect(
      service.renameFile({
        path: "source.txt",
        name: "occupied.txt",
        revision: source.revision,
      }),
    ).rejects.toMatchObject({ status: 409, reason: "exists" });
    const renamed = await service.renameFile({
      path: "source.txt",
      name: "renamed.txt",
      revision: source.revision,
    });
    expect(renamed.path).toBe("renamed.txt");
    await expect(readFile(join(root, "source.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    await writeFile(join(root, "renamed.txt"), "changed");
    await expect(
      service.deleteFile({
        path: "renamed.txt",
        revision: renamed.revision,
      }),
    ).rejects.toMatchObject({ status: 409, reason: "stale" });
    const latest = await service.inspectFile("renamed.txt");
    await service.deleteFile({
      path: "renamed.txt",
      revision: latest.revision,
    });
    await expect(readFile(join(root, "renamed.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("streams bounded binary downloads and cancels the underlying stream", async () => {
    const root = await temporaryWorkspace();
    const bytes = Buffer.from([0, 1, 2, 3, 4]);
    await writeFile(join(root, "binary.dat"), bytes);
    const service = new WorkspaceService(root);
    const download = await service.downloadFile("binary.dat");

    expect(download.name).toBe("binary.dat");
    expect(download.size).toBe(bytes.length);
    expect(
      Buffer.from(await new Response(download.stream).arrayBuffer()),
    ).toEqual(bytes);

    await writeFile(join(root, "empty.dat"), "");
    const empty = await service.downloadFile("empty.dat");
    expect(empty.size).toBe(0);
    expect((await new Response(empty.stream).arrayBuffer()).byteLength).toBe(0);

    const tooLarge = await open(join(root, "huge.dat"), "w");
    await tooLarge.truncate(MAX_WORKSPACE_DOWNLOAD_BYTES + 1);
    await tooLarge.close();
    await expect(service.inspectFile("huge.dat")).resolves.toMatchObject({
      downloadable: false,
      editable: false,
      reason: "too_large",
    });
    await expect(service.downloadFile("huge.dat")).rejects.toMatchObject({
      status: 413,
      reason: "too_large",
    });

    const cancellable = await service.downloadFile("binary.dat");
    await cancellable.stream.cancel();
  });
});
