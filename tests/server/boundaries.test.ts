import { win32 } from "node:path";
import { describe, expect, test } from "vitest";
import { parseDuration } from "../../src/server/heartbeat/duration.js";
import {
  isPathContained,
  safeMarkdownPath,
} from "../../src/server/resources/paths.js";
import { apiError } from "../../src/shared/contracts.js";

describe("parseDuration", () => {
  test.each([
    ["1m", 60_000],
    ["30m", 1_800_000],
    ["2h", 7_200_000],
    ["7d", 604_800_000],
  ])("parses %s", (value, expected) => {
    expect(parseDuration(value)).toBe(expected);
  });

  test.each(["", "0m", "8d", "1.5h", " 30m", "30m ", "30s"])(
    "rejects %j",
    (value) => {
      expect(() => parseDuration(value)).toThrow(/duration/i);
    },
  );
});

describe("safeMarkdownPath", () => {
  test.each([
    "daily-review",
    "Existing_Name",
    "review.v2",
    "foo:bar",
    "界".repeat(84),
  ])("builds a contained markdown path for native name %s", (name) => {
    expect(safeMarkdownPath("/agent/prompts", name)).toBe(
      `/agent/prompts/${name}.md`,
    );
  });

  test("uses native Windows path semantics for containment", () => {
    expect(
      isPathContained(
        "C:\\agent\\prompts",
        "C:\\agent\\prompts\\review.md",
        win32,
      ),
    ).toBe(true);
    expect(
      isPathContained("C:\\agent\\prompts", "C:\\agent\\auth.md", win32),
    ).toBe(false);
  });

  test.each([
    "../auth",
    "nested/name",
    "nested\\name",
    ".hidden",
    "a b",
    "line\nbreak",
    "a".repeat(201),
    "界".repeat(85),
  ])("rejects %j", (name) => {
    expect(() => safeMarkdownPath("/agent/prompts", name)).toThrow(/name/i);
  });
});

describe("API errors", () => {
  test("uses a stable code and optional parameters", () => {
    expect(apiError("agent_busy", { retryAfter: 2 })).toEqual({
      error: { code: "agent_busy", params: { retryAfter: 2 } },
    });
  });
});
