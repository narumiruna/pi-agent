import { readdir } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import type {
  PromptTemplate,
  ResourceDiagnostic,
} from "@earendil-works/pi-coding-agent";
import type {
  WebPromptDiagnostic,
  WebPromptWriteScope,
} from "../../shared/contracts.js";
import {
  validatePrompt,
  validatePromptName,
} from "../../shared/prompt-validation.js";
import {
  opaquePromptId,
  safeMetadataText,
  safePromptMetadataText,
} from "../api-metadata.js";

const MAX_PROMPT_DIAGNOSTICS = 100;

interface PromptFileSnapshot {
  content: string;
  truncated: boolean;
}

interface PromptDiagnosticOptions {
  nativeDiagnostics: ReadonlyArray<ResourceDiagnostic>;
  projectRoot: string;
  projectTrusted: boolean;
  prompts: ReadonlyArray<PromptTemplate>;
  readActive(prompt: PromptTemplate): Promise<PromptFileSnapshot>;
  readCanonical(
    filePath: string,
    scope: WebPromptWriteScope,
  ): Promise<PromptFileSnapshot>;
  resourcePath(prompt: PromptTemplate): string;
  userRoot: string;
}

function isWithin(filePath: string, root: string): boolean {
  const target = resolve(filePath);
  const boundary = resolve(root);
  return target === boundary || target.startsWith(`${boundary}${sep}`);
}

function logicalRelative(filePath: string, root: string): string {
  return relative(root, filePath).split(sep).join("/");
}

function diagnosticPath(
  filePath: string,
  options: PromptDiagnosticOptions,
): string {
  const active = options.prompts.find(
    (prompt) => resolve(prompt.filePath) === resolve(filePath),
  );
  if (active) return safeMetadataText(options.resourcePath(active));
  if (isWithin(filePath, options.userRoot))
    return safeMetadataText(
      `~/.pi/agent/prompts/${logicalRelative(filePath, options.userRoot)}`,
    );
  if (isWithin(filePath, options.projectRoot))
    return safeMetadataText(
      `.pi/prompts/${logicalRelative(filePath, options.projectRoot)}`,
    );
  return safeMetadataText(`external/${basename(filePath)}`);
}

async function activeDiagnostics(
  prompt: PromptTemplate,
  options: PromptDiagnosticOptions,
): Promise<WebPromptDiagnostic[]> {
  let validation = validatePromptName(prompt.name);
  const projectAllowed =
    prompt.sourceInfo.scope !== "project" || options.projectTrusted;
  if (projectAllowed) {
    try {
      const raw = await options.readActive(prompt);
      validation = validatePrompt(prompt.name, raw.content, raw.truncated);
    } catch {
      // Pi remains authoritative when a prompt cannot be safely inspected.
    }
  }
  return validation.map((diagnostic) => ({
    ...diagnostic,
    name: safePromptMetadataText(prompt.name).replaceAll("\n", " "),
    path: safeMetadataText(options.resourcePath(prompt)),
    promptId: opaquePromptId(prompt.sourceInfo),
  }));
}

async function omittedCanonicalDiagnostics(
  scope: WebPromptWriteScope,
  activePaths: ReadonlySet<string>,
  options: PromptDiagnosticOptions,
): Promise<WebPromptDiagnostic[]> {
  if (scope === "project" && !options.projectTrusted) return [];
  const root = scope === "user" ? options.userRoot : options.projectRoot;
  const entries = await readdir(root, { withFileTypes: true }).catch(
    () => undefined,
  );
  if (!entries) return [];
  const diagnostics: WebPromptDiagnostic[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = join(root, entry.name);
    if (activePaths.has(resolve(filePath))) continue;
    try {
      const raw = await options.readCanonical(filePath, scope);
      const name = entry.name.slice(0, -3);
      diagnostics.push(
        ...validatePrompt(name, raw.content, raw.truncated).map(
          (diagnostic) => ({
            ...diagnostic,
            name: safePromptMetadataText(name).replaceAll("\n", " "),
            path: diagnosticPath(filePath, options),
          }),
        ),
      );
    } catch {
      // Unsafe or unreadable files are outside Web validation ownership.
    }
  }
  return diagnostics;
}

function collisionDiagnostics(
  options: PromptDiagnosticOptions,
): WebPromptDiagnostic[] {
  const diagnostics: WebPromptDiagnostic[] = [];
  for (const diagnostic of options.nativeDiagnostics) {
    const collision = diagnostic.collision;
    if (diagnostic.type !== "collision" || collision?.resourceType !== "prompt")
      continue;
    const winner = options.prompts.find(
      (prompt) => resolve(prompt.filePath) === resolve(collision.winnerPath),
    );
    diagnostics.push({
      code: "name_collision",
      severity: "warning",
      name: safePromptMetadataText(collision.name).replaceAll("\n", " "),
      path: diagnosticPath(collision.winnerPath, options),
      relatedPath: diagnosticPath(collision.loserPath, options),
      ...(winner ? { promptId: opaquePromptId(winner.sourceInfo) } : {}),
    });
  }
  return diagnostics;
}

export async function projectPromptDiagnostics(
  options: PromptDiagnosticOptions,
): Promise<WebPromptDiagnostic[]> {
  const activePaths = new Set(
    options.prompts.map((prompt) => resolve(prompt.filePath)),
  );
  const diagnostics = (
    await Promise.all(
      options.prompts.map((prompt) => activeDiagnostics(prompt, options)),
    )
  ).flat();
  diagnostics.push(
    ...(await omittedCanonicalDiagnostics("user", activePaths, options)),
    ...(await omittedCanonicalDiagnostics("project", activePaths, options)),
    ...collisionDiagnostics(options),
  );
  const unique = new Map<string, WebPromptDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.code,
      diagnostic.name,
      diagnostic.path,
      diagnostic.relatedPath,
      diagnostic.promptId,
    ].join("\0");
    if (!unique.has(key)) unique.set(key, diagnostic);
  }
  return [...unique.values()]
    .sort((left, right) =>
      `${left.path ?? ""}\0${left.code}\0${left.relatedPath ?? ""}`.localeCompare(
        `${right.path ?? ""}\0${right.code}\0${right.relatedPath ?? ""}`,
      ),
    )
    .slice(0, MAX_PROMPT_DIAGNOSTICS);
}
