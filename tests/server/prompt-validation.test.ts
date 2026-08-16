import { describe, expect, test } from "vitest";
import {
  isValidPromptName,
  validatePrompt,
  validatePromptContent,
  validatePromptName,
} from "../../src/shared/prompt-validation.js";

describe("prompt validation", () => {
  test("uses Pi-compatible command names and UTF-8 filename bytes", () => {
    expect(isValidPromptName("Existing_Name.v2:review")).toBe(true);
    expect(isValidPromptName("é".repeat(126))).toBe(true);
    expect(isValidPromptName("é".repeat(127))).toBe(false);

    for (const name of ["", ".hidden", "bad name", "nested/name", "bad\0name"])
      expect(validatePromptName(name)).toEqual([
        { code: "invalid_name", severity: "error" },
      ]);
  });

  test("accepts documented string frontmatter and ordinary Markdown", () => {
    expect(
      validatePromptContent(
        '---\r\ndescription: Review changes\r\nargument-hint: "<PR>"\r\n---\r\nReview $1',
      ),
    ).toEqual([]);
    expect(validatePromptContent("Review staged changes\n")).toEqual([]);
    expect(validatePromptContent("---\n---\nBody")).toEqual([]);
  });

  test.each([
    "---\ndescription: [\n---\nBody",
    "---\ndescription: Missing close",
    "---\n- description\n---\nBody",
    "---\ndescription: 42\n---\nBody",
    "---\nargument-hint: false\n---\nBody",
  ])("reports invalid YAML frontmatter for %j", (content) => {
    expect(validatePromptContent(content)).toEqual([
      { code: "invalid_frontmatter", severity: "error" },
    ]);
  });

  test("measures prompt content in UTF-8 bytes before YAML parsing", () => {
    expect(validatePromptContent("é".repeat(500_000))).toEqual([]);
    expect(validatePromptContent("é".repeat(500_001))).toEqual([
      { code: "content_too_large", severity: "error" },
    ]);
    expect(validatePromptContent("Body", true)).toEqual([
      { code: "content_too_large", severity: "error" },
    ]);
  });

  test("returns stable name-before-content diagnostics", () => {
    expect(
      validatePrompt("bad name", "---\ndescription: [\n---\nBody"),
    ).toEqual([
      { code: "invalid_name", severity: "error" },
      { code: "invalid_frontmatter", severity: "error" },
    ]);
  });
});
