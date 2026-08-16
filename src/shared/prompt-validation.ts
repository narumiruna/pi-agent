import { parseDocument } from "yaml";

export const PROMPT_NAME_PATTERN =
  "^(?!\\.)[^\\s/\\\\\\u0000-\\u001F\\u007F]+$";
export const MAX_PROMPT_NAME_LENGTH = 200;
export const MAX_PROMPT_FILENAME_BYTES = 255;
export const MAX_PROMPT_CONTENT_BYTES = 1_000_000;

const PROMPT_NAME = new RegExp(PROMPT_NAME_PATTERN);
const UTF8_ENCODER = new TextEncoder();

export type PromptDiagnosticCode =
  | "content_too_large"
  | "invalid_frontmatter"
  | "invalid_name"
  | "name_collision";

export interface PromptValidationDiagnostic {
  code: Exclude<PromptDiagnosticCode, "name_collision">;
  severity: "error";
}

export function isValidPromptName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= MAX_PROMPT_NAME_LENGTH &&
    UTF8_ENCODER.encode(`${name}.md`).byteLength <= MAX_PROMPT_FILENAME_BYTES &&
    PROMPT_NAME.test(name)
  );
}

function hasInvalidFrontmatter(content: string): boolean {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return false;
  const end = normalized.indexOf("\n---", 3);
  if (end < 0) return true;
  const yaml = normalized.slice(4, end);
  try {
    const document = parseDocument(yaml, { prettyErrors: false });
    if (document.errors.length > 0) return true;
    const frontmatter = document.toJS();
    if (
      frontmatter !== null &&
      (typeof frontmatter !== "object" || Array.isArray(frontmatter))
    )
      return true;
    if (frontmatter === null) return false;
    for (const field of ["description", "argument-hint"]) {
      if (
        Object.hasOwn(frontmatter, field) &&
        typeof frontmatter[field] !== "string"
      )
        return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function validatePromptName(name: string): PromptValidationDiagnostic[] {
  return isValidPromptName(name)
    ? []
    : [{ code: "invalid_name", severity: "error" }];
}

export function validatePromptContent(
  content: string,
  truncated = false,
): PromptValidationDiagnostic[] {
  if (
    truncated ||
    UTF8_ENCODER.encode(content).byteLength > MAX_PROMPT_CONTENT_BYTES
  )
    return [{ code: "content_too_large", severity: "error" }];
  return hasInvalidFrontmatter(content)
    ? [{ code: "invalid_frontmatter", severity: "error" }]
    : [];
}

export function validatePrompt(
  name: string,
  content: string,
  truncated = false,
): PromptValidationDiagnostic[] {
  return [
    ...validatePromptName(name),
    ...validatePromptContent(content, truncated),
  ];
}
