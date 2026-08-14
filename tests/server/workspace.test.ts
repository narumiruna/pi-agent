import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { searchWorkspace } from "../../src/server/workspace/search.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanups
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("workspace file search", () => {
  test("returns bounded relative matches and skips secrets and symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-agent-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-agent-outside-"));
    cleanups.push(root, outside);
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await mkdir(join(root, "custom-agent-data"));
    await writeFile(join(root, "src", "api-client.ts"), "export {};");
    await writeFile(join(root, ".env"), "SECRET=value");
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
    expect(await searchWorkspace(root, "outside")).toEqual([]);
  });

  test("supports fuzzy matching and an aborted search", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-agent-workspace-"));
    cleanups.push(root);
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
