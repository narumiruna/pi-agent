import { describe, expect, test } from "vitest";
import { parseDuration } from "../../src/server/heartbeat/duration.js";
import { safeMarkdownPath } from "../../src/server/resources/paths.js";
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
  test("builds a contained markdown path from a slug", () => {
    expect(safeMarkdownPath("/agent/prompts", "daily-review")).toBe(
      "/agent/prompts/daily-review.md",
    );
  });

  test.each(["../auth", "nested/name", ".hidden", "UPPER", "a b", "a.md"])(
    "rejects %j",
    (name) => {
      expect(() => safeMarkdownPath("/agent/prompts", name)).toThrow(/name/i);
    },
  );
});

describe("API errors", () => {
  test("uses a stable code and optional parameters", () => {
    expect(apiError("agent_busy", { retryAfter: 2 })).toEqual({
      error: { code: "agent_busy", params: { retryAfter: 2 } },
    });
  });
});
