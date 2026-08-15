export type EditorAppearance = "dark" | "light";
export type EditorMode = "monaco" | "plain";
export type EditorWhitespace = "all" | "none" | "selection";
export type MonacoWorkerKind =
  | "css"
  | "editor"
  | "html"
  | "json"
  | "typescript";

export interface EditorSettings {
  version: 1;
  fontSize: 12 | 14 | 16 | 18 | 20;
  tabSize: 2 | 4 | 8;
  wordWrap: boolean;
  minimap: boolean;
  whitespace: EditorWhitespace;
  mode: EditorMode;
}

export const EDITOR_SETTINGS_KEY = "pi-agent-files-editor-v1";

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  version: 1,
  fontSize: 14,
  tabSize: 2,
  wordWrap: false,
  minimap: true,
  whitespace: "selection",
  mode: "monaco",
};

const FONT_SIZES = new Set<EditorSettings["fontSize"]>([12, 14, 16, 18, 20]);
const TAB_SIZES = new Set<EditorSettings["tabSize"]>([2, 4, 8]);
const WHITESPACE_VALUES = new Set<EditorWhitespace>([
  "all",
  "none",
  "selection",
]);
const EDITOR_MODES = new Set<EditorMode>(["monaco", "plain"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEditorSettings(raw: string | null): EditorSettings {
  if (!raw) return { ...DEFAULT_EDITOR_SETTINGS };
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1)
      return { ...DEFAULT_EDITOR_SETTINGS };
    return {
      version: 1,
      fontSize: FONT_SIZES.has(value.fontSize as EditorSettings["fontSize"])
        ? (value.fontSize as EditorSettings["fontSize"])
        : DEFAULT_EDITOR_SETTINGS.fontSize,
      tabSize: TAB_SIZES.has(value.tabSize as EditorSettings["tabSize"])
        ? (value.tabSize as EditorSettings["tabSize"])
        : DEFAULT_EDITOR_SETTINGS.tabSize,
      wordWrap:
        typeof value.wordWrap === "boolean"
          ? value.wordWrap
          : DEFAULT_EDITOR_SETTINGS.wordWrap,
      minimap:
        typeof value.minimap === "boolean"
          ? value.minimap
          : DEFAULT_EDITOR_SETTINGS.minimap,
      whitespace: WHITESPACE_VALUES.has(value.whitespace as EditorWhitespace)
        ? (value.whitespace as EditorWhitespace)
        : DEFAULT_EDITOR_SETTINGS.whitespace,
      mode: EDITOR_MODES.has(value.mode as EditorMode)
        ? (value.mode as EditorMode)
        : DEFAULT_EDITOR_SETTINGS.mode,
    };
  } catch {
    return { ...DEFAULT_EDITOR_SETTINGS };
  }
}

export function loadEditorSettings(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): EditorSettings {
  try {
    return parseEditorSettings(storage.getItem(EDITOR_SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_EDITOR_SETTINGS };
  }
}

export function saveEditorSettings(
  settings: EditorSettings,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  try {
    storage.setItem(EDITOR_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // A blocked or full local store must not make workspace files unusable.
  }
}

const LANGUAGE_LABELS: Record<string, string> = {
  css: "CSS",
  dockerfile: "Dockerfile",
  go: "Go",
  html: "HTML",
  ini: "INI",
  javascript: "JavaScript",
  json: "JSON",
  less: "Less",
  markdown: "Markdown",
  plaintext: "Plain text",
  python: "Python",
  rust: "Rust",
  scss: "SCSS",
  shell: "Shell",
  sql: "SQL",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};

export function languageLabel(language: string): string {
  return LANGUAGE_LABELS[language] ?? language;
}

export function languageForPath(path: string): string {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (name === "dockerfile" || name.startsWith("dockerfile."))
    return "dockerfile";
  if (name === "compose.yaml" || name === "compose.yml") return "yaml";

  const extension = name.includes(".") ? name.split(".").at(-1) : undefined;
  switch (extension) {
    case "cjs":
    case "js":
    case "jsx":
    case "mjs":
      return "javascript";
    case "cts":
    case "mts":
    case "ts":
    case "tsx":
      return "typescript";
    case "json":
    case "jsonc":
      return "json";
    case "md":
    case "mdx":
    case "markdown":
      return "markdown";
    case "yaml":
    case "yml":
      return "yaml";
    case "htm":
    case "html":
      return "html";
    case "css":
      return "css";
    case "less":
      return "less";
    case "scss":
      return "scss";
    case "py":
    case "pyw":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "bash":
    case "fish":
    case "sh":
    case "zsh":
      return "shell";
    case "sql":
      return "sql";
    case "svg":
    case "xml":
      return "xml";
    case "cfg":
    case "conf":
    case "ini":
    case "properties":
    case "toml":
      return "ini";
    default:
      return "plaintext";
  }
}

export function lineEndingFor(value: string): "CR" | "CRLF" | "LF" {
  if (value.includes("\r\n")) return "CRLF";
  if (value.includes("\r")) return "CR";
  return "LF";
}

export function workspaceModelUri(
  path: string,
  view: "conflict-modified" | "conflict-original" | "editor" = "editor",
): string {
  const segments = path.split("/");
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Workspace model paths must be canonical and relative");
  }
  const encodedPath = segments.map(encodeURIComponent).join("/");
  return `pi-workspace://workspace/${encodedPath}?view=${view}`;
}

export function workerKindForLabel(label: string): MonacoWorkerKind {
  if (label === "json") return "json";
  if (label === "css" || label === "scss" || label === "less") return "css";
  if (label === "html" || label === "handlebars" || label === "razor")
    return "html";
  if (label === "typescript" || label === "javascript") return "typescript";
  return "editor";
}
