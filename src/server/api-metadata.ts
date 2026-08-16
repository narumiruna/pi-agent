import { createHash } from "node:crypto";
import { basename, dirname, resolve, sep } from "node:path";
import type {
  ProgressEvent,
  SourceInfo,
} from "@earendil-works/pi-coding-agent";
import type {
  WebMcpDiagnostic,
  WebPackageProgress,
  WebPackageSummary,
  WebResourceProvenance,
} from "../shared/contracts.js";
import { sanitizeExtensionText } from "./interactions/web-state.js";
import type { McpDiagnostic } from "./mcp/manager.js";

const MAX_DIAGNOSTICS = 100;
const MAX_DIAGNOSTIC_MESSAGE = 1_000;
const MAX_PACKAGE_NAME = 200;
const ABSOLUTE_PATH =
  /(^|[\s([{:=>,"'`])(?:[A-Za-z]:[\\/]|\/)[^\s)\]}"'`<>]+/gmu;

export function opaquePackageId(
  scope: "project" | "user",
  source: string,
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([scope, source]))
    .digest("base64url");
  return `pkg_${digest}`;
}

export function opaquePromptId(
  sourceInfo: Pick<SourceInfo, "origin" | "path" | "scope" | "source">,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        sourceInfo.scope,
        sourceInfo.origin,
        sourceInfo.source,
        sourceInfo.path,
      ]),
    )
    .digest("base64url");
  return `prompt_${digest}`;
}

export function opaqueSkillId(
  sourceInfo: Pick<SourceInfo, "origin" | "path" | "scope" | "source">,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        sourceInfo.scope,
        sourceInfo.origin,
        sourceInfo.source,
        sourceInfo.path,
      ]),
    )
    .digest("base64url");
  return `skill_${digest}`;
}

export function opaqueResourceCommandId(
  kind: "extension" | "prompt" | "skill",
  name: string,
  sourceInfo: Pick<SourceInfo, "origin" | "path" | "scope" | "source">,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        kind,
        name,
        sourceInfo.scope,
        sourceInfo.origin,
        sourceInfo.source,
        sourceInfo.path,
      ]),
    )
    .digest("base64url");
  return `command_${digest}`;
}

function gitSourceLabel(source: string): string | undefined {
  const trimmed = source.trim();
  const candidate =
    trimmed.startsWith("git:") && !trimmed.startsWith("git://")
      ? trimmed.slice(4)
      : trimmed;
  let host = "";
  let rawPath = "";
  const scp = candidate.match(/^git@([^:]+):(.+)$/u);
  if (scp) {
    host = scp[1] ?? "";
    rawPath = scp[2] ?? "";
  } else if (/^(?:git|https?|ssh):\/\//iu.test(candidate)) {
    try {
      const url = new URL(candidate);
      host = url.hostname;
      rawPath = url.pathname.replace(/^\/+/, "");
    } catch {
      return undefined;
    }
  } else if (trimmed.startsWith("git:")) {
    const slash = candidate.indexOf("/");
    if (slash < 0) return undefined;
    host = candidate.slice(0, slash);
    rawPath = candidate.slice(slash + 1);
  } else {
    return undefined;
  }
  const ref = rawPath.indexOf("@");
  const repositoryPath = ref < 0 ? rawPath : rawPath.slice(0, ref);
  const parts = repositoryPath
    .split("/")
    .filter(Boolean)
    .map((part, index, values) =>
      index === values.length - 1 ? part.replace(/\.git$/iu, "") : part,
    );
  if (!host || parts.length < 2) return undefined;
  return sanitizeExtensionText([host, ...parts].join("/"), MAX_PACKAGE_NAME);
}

export function safePackageName(source: string): string {
  const gitLabel = gitSourceLabel(source);
  if (gitLabel) return gitLabel;
  if (source.startsWith("npm:"))
    return sanitizeExtensionText(source.slice(4), MAX_PACKAGE_NAME);
  const normalized = source.replaceAll("\\", "/").replace(/\/+$/, "");
  const name = sanitizeExtensionText(
    basename(normalized).replace(/\.git$/i, "") || "local-package",
    MAX_PACKAGE_NAME - 9,
  );
  const suffix = createHash("sha256").update(source).digest("hex").slice(0, 8);
  return `${name}-${suffix}`;
}

export function safePromptSourceLabel(
  sourceInfo: Pick<SourceInfo, "origin" | "path" | "scope" | "source">,
  canonicalRoots: readonly string[] = [],
  recursiveRoots = false,
): string {
  if (sourceInfo.origin === "package")
    return safePackageName(sourceInfo.source);
  if (sourceInfo.scope === "temporary") {
    if (sourceInfo.source.startsWith("extension:"))
      return sanitizeExtensionText(sourceInfo.source, MAX_PACKAGE_NAME);
    return "CLI";
  }
  if (sourceInfo.source === "auto") return "local";
  if (
    canonicalRoots.some((root) => {
      const parent = resolve(dirname(sourceInfo.path));
      const boundary = resolve(root);
      return recursiveRoots
        ? parent === boundary || parent.startsWith(`${boundary}${sep}`)
        : parent === boundary;
    })
  )
    return "local";
  if (canonicalRoots.length > 0) return "settings";
  if (sourceInfo.source === "local" || sourceInfo.source === "auto")
    return "local";
  return "settings";
}

export function projectResourceProvenance(
  sourceInfo: Pick<SourceInfo, "origin" | "scope">,
): WebResourceProvenance {
  return {
    scope: sourceInfo.scope,
    origin: sourceInfo.origin,
  };
}

export function projectPackageSummary(item: {
  source: string;
  scope: "project" | "user";
  filtered: boolean;
}): WebPackageSummary {
  return {
    id: opaquePackageId(item.scope, item.source),
    name: safePackageName(item.source),
    scope: item.scope,
    filtered: item.filtered,
    provenance: projectResourceProvenance({
      scope: item.scope,
      origin: "package",
    }),
  };
}

export function safePromptMetadataText(value: string): string {
  return sanitizeExtensionText(value, MAX_DIAGNOSTIC_MESSAGE);
}

export function safeMetadataText(value: string): string {
  return sanitizeExtensionText(value, MAX_DIAGNOSTIC_MESSAGE).replace(
    ABSOLUTE_PATH,
    (_match, prefix: string) => `${prefix}<path>`,
  );
}

export function projectPackageProgress(
  event: ProgressEvent,
): WebPackageProgress {
  return {
    type: event.type,
    action: event.action,
    ...(event.message ? { message: safeMetadataText(event.message) } : {}),
  };
}

export function projectMcpDiagnostics(
  diagnostics: readonly McpDiagnostic[],
): WebMcpDiagnostic[] {
  return diagnostics.slice(0, MAX_DIAGNOSTICS).map((diagnostic) => ({
    server:
      sanitizeExtensionText(diagnostic.server, 64).replaceAll("\n", " ") ||
      "mcp",
    level: diagnostic.level,
    message: safeMetadataText(diagnostic.message),
  }));
}
