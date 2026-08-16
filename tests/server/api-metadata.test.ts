import { describe, expect, test } from "vitest";
import {
  opaquePackageId,
  opaquePromptId,
  opaqueSkillId,
  projectMcpDiagnostics,
  projectPackageProgress,
  projectPackageSummary,
  projectResourceProvenance,
  safePackageName,
  safePromptMetadataText,
  safePromptSourceLabel,
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
    const firstLocal = safePackageName("/private/host/packages/local-tool");
    const secondLocal = safePackageName("/other/host/packages/local-tool");
    expect(firstLocal).toMatch(/^local-tool-[a-f0-9]{8}$/);
    expect(secondLocal).toMatch(/^local-tool-[a-f0-9]{8}$/);
    expect(firstLocal).not.toBe(secondLocal);
    expect(safePackageName("npm:@scope/package@1.0.0")).toBe(
      "@scope/package@1.0.0",
    );
    expect(safePackageName("git:git@github.com:org/repository.git@v1")).toBe(
      "github.com/org/repository",
    );
    expect(
      safePackageName("https://github.com/org/repository@refs/tags/v1"),
    ).toBe("github.com/org/repository");
    expect(
      safePackageName("git:git@github.com:org/repository@feature/review-ui"),
    ).toBe("github.com/org/repository");
    expect(safePackageName("git:git@gitlab.com:org/repository.git@v1")).toBe(
      "gitlab.com/org/repository",
    );
    expect(safePackageName("git:github.com/org/repository")).toBe(
      "github.com/org/repository",
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

  test("creates stable path-free skill IDs", () => {
    const sourceInfo = {
      path: "/private/cache/package/skills/review/SKILL.md",
      source: "https://secret@example.com/org/review.git?token=private",
      scope: "project" as const,
      origin: "package" as const,
    };
    const id = opaqueSkillId(sourceInfo);

    expect(id).toMatch(/^skill_[A-Za-z0-9_-]{43}$/);
    expect(id).toBe(opaqueSkillId(sourceInfo));
    expect(id).not.toMatch(/private|secret|review/);
    expect(id).not.toBe(
      opaqueSkillId({ ...sourceInfo, path: `${sourceInfo.path}.other` }),
    );
  });

  test("creates opaque prompt IDs and safe source labels", () => {
    const sourceInfo = {
      path: "/private/cache/package/prompts/review.md",
      source: "https://secret@example.com/org/review.git?token=private",
      scope: "project" as const,
      origin: "package" as const,
    };
    const id = opaquePromptId(sourceInfo);

    expect(id).toMatch(/^prompt_[A-Za-z0-9_-]{43}$/);
    expect(id).toBe(opaquePromptId(sourceInfo));
    expect(id).not.toMatch(/private|secret|review/);
    expect(safePromptSourceLabel(sourceInfo)).toBe("example.com/org/review");
    expect(
      safePromptSourceLabel({
        path: "/private/temporary/review.md",
        source: "local",
        scope: "temporary",
        origin: "top-level",
      }),
    ).toBe("CLI");
    expect(
      safePromptSourceLabel({
        path: "/private/temporary/review.md",
        source: "extension:review-tools",
        scope: "temporary",
        origin: "top-level",
      }),
    ).toBe("extension:review-tools");
    const roots = ["/agent/prompts", "/workspace/.pi/prompts"];
    expect(
      safePromptSourceLabel(
        {
          path: "/private/settings/review.md",
          source: "local",
          scope: "user",
          origin: "top-level",
        },
        roots,
      ),
    ).toBe("settings");
    expect(
      safePromptSourceLabel(
        {
          path: "/agent/prompts/review.md",
          source: "auto",
          scope: "user",
          origin: "top-level",
        },
        roots,
      ),
    ).toBe("local");
  });

  test("preserves slash commands in prompt-authored metadata", () => {
    expect(safePromptMetadataText("Use /review before merge")).toBe(
      "Use /review before merge",
    );
    expect(safePromptMetadataText("\u001b[31m/review\u001b[0m")).toBe(
      "/review",
    );
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
          '\u001b[31mspawn failed at "/private/agent/server.ts" and `C:\\Users\\owner\\secret.txt`\u001b[0m',
      },
    ]);

    expect(diagnostics).toEqual([
      {
        server: "local server",
        level: "error",
        message: 'spawn failed at "<path>" and `<path>`',
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
