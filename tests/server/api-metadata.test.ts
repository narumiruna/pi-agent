import { describe, expect, test } from "vitest";
import {
  opaquePackageId,
  projectMcpDiagnostics,
  projectPackageProgress,
  projectPackageSummary,
  projectResourceProvenance,
  safePackageName,
} from "../../src/server/api-metadata.js";

describe("safe API metadata projections", () => {
  test("creates stable scope-separated opaque package IDs", () => {
    const source = "/private/host/packages/example";
    const userId = opaquePackageId("user", source);

    expect(userId).toBe(opaquePackageId("user", source));
    expect(userId).not.toBe(opaquePackageId("project", source));
    expect(userId).toMatch(/^pkg_[A-Za-z0-9_-]{43}$/);
    expect(userId).not.toContain("private");
    expect(userId).not.toContain("example");
  });

  test("projects package metadata without source, credentials, or paths", () => {
    const remote = projectPackageSummary({
      source: "https://secret@example.com/org/repository.git?token=private",
      scope: "project",
      filtered: true,
    });
    expect(remote).toMatchObject({
      name: "example.com/org/repository",
      scope: "project",
      filtered: true,
      provenance: { scope: "project", origin: "package" },
    });
    expect(JSON.stringify(remote)).not.toMatch(/secret|token|private/);
    expect(safePackageName("/private/host/packages/local-tool")).toBe(
      "local-tool",
    );
    expect(safePackageName("npm:@scope/package@1.0.0")).toBe(
      "@scope/package@1.0.0",
    );

    const response = JSON.stringify(
      projectPackageSummary({
        source: "/private/host/packages/local-tool",
        scope: "user",
        filtered: false,
      }),
    );
    expect(response).not.toContain("source");
    expect(response).not.toContain("installedPath");
    expect(response).not.toContain("/private");
  });

  test("projects only native scope and origin provenance", () => {
    const sourceInfo = {
      path: "/private/project/.pi/prompts/review.md",
      source: "npm:secret-package",
      scope: "temporary",
      origin: "top-level",
      baseDir: "/private/project",
    } as const;
    const provenance = projectResourceProvenance(sourceInfo);

    expect(provenance).toEqual({
      scope: "temporary",
      origin: "top-level",
    });
    expect(JSON.stringify(provenance)).not.toMatch(
      /private|secret|path|source/,
    );
  });

  test("drops package sources and sanitizes progress messages", () => {
    expect(
      projectPackageProgress({
        type: "progress",
        action: "install",
        source: "https://secret@example.com/private/package",
        message: "Installing /private/cache/package",
      }),
    ).toEqual({
      type: "progress",
      action: "install",
      message: "Installing <path>",
    });
  });

  test("bounds diagnostics and removes terminal controls and absolute paths", () => {
    const diagnostics = projectMcpDiagnostics([
      {
        server: "local\nserver",
        level: "error",
        message:
          "\u001b[31mspawn failed at /private/agent/server.ts and C:\\Users\\owner\\secret.txt\u001b[0m",
      },
    ]);

    expect(diagnostics).toEqual([
      {
        server: "local server",
        level: "error",
        message: "spawn failed at <path> and <path>",
      },
    ]);
    expect(
      projectMcpDiagnostics(
        Array.from({ length: 120 }, (_, index) => ({
          server: `server-${index}`,
          level: "warning" as const,
          message: "warning",
        })),
      ),
    ).toHaveLength(100);
  });
});
