import { createHash } from "node:crypto";
import { basename } from "node:path";
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
const ABSOLUTE_PATH = /(^|[\s([{:=>,])(?:[A-Za-z]:[\\/]|\/)[^\s)\]}"'`<>]+/gmu;

export function opaquePackageId(
  scope: "project" | "user",
  source: string,
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([scope, source]))
    .digest("base64url");
  return `pkg_${digest}`;
}

function sourceUrl(source: string): URL | undefined {
  const candidate = source.startsWith("git:") ? source.slice(4) : source;
  if (!/^(?:https?|ssh):\/\//.test(candidate)) return undefined;
  try {
    return new URL(candidate);
  } catch {
    return undefined;
  }
}

export function safePackageName(source: string): string {
  const url = sourceUrl(source);
  if (url) {
    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .slice(-2)
      .map((part) => part.replace(/\.git$/i, ""));
    return sanitizeExtensionText(
      [url.hostname, ...parts].filter(Boolean).join("/"),
      MAX_PACKAGE_NAME,
    );
  }
  if (source.startsWith("npm:"))
    return sanitizeExtensionText(source.slice(4), MAX_PACKAGE_NAME);
  const normalized = source.replaceAll("\\", "/").replace(/\/+$/, "");
  const name = basename(normalized).replace(/\.git$/i, "");
  return sanitizeExtensionText(name || "local-package", MAX_PACKAGE_NAME);
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
