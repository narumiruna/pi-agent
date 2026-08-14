import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { parseSessionEntries } from "@earendil-works/pi-coding-agent";

const MAX_IMPORT_BYTES = 5_000_000;
const ENTRY_TYPES = new Set([
  "branch_summary",
  "compaction",
  "custom",
  "custom_message",
  "label",
  "message",
  "model_change",
  "session_info",
  "thinking_level_change",
]);
function validId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
  );
}

function validText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function validEntryShape(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const value = entry as Record<string, unknown>;
  if (
    !validText(value.type, 64) ||
    !ENTRY_TYPES.has(value.type) ||
    !validText(value.timestamp, 100)
  )
    return false;
  switch (value.type) {
    case "message": {
      const message = value.message as Record<string, unknown> | undefined;
      return Boolean(message && validText(message.role, 100));
    }
    case "model_change":
      return validText(value.provider, 500) && validText(value.modelId, 500);
    case "thinking_level_change":
      return validText(value.thinkingLevel, 100);
    case "compaction":
      return (
        validText(value.summary, MAX_IMPORT_BYTES) &&
        validId(value.firstKeptEntryId)
      );
    case "branch_summary":
      return (
        validText(value.summary, MAX_IMPORT_BYTES) && validId(value.fromId)
      );
    case "custom":
    case "custom_message":
      return validText(value.customType, 500);
    case "label":
      return (
        validId(value.targetId) &&
        (value.label === undefined || validText(value.label, 1_000))
      );
    case "session_info":
      return value.name === undefined || validText(value.name, 1_000);
    default:
      return false;
  }
}

export interface ConversationExport {
  content: Buffer;
  contentType: string;
  fileName: string;
}

export function validateSessionImport(
  content: string,
  existingIds: ReadonlySet<string>,
): string {
  if (Buffer.byteLength(content, "utf8") > MAX_IMPORT_BYTES)
    throw new Error("Session import is too large");
  const entries = parseSessionEntries(content);
  const header = entries[0];
  if (
    header?.type !== "session" ||
    !validId(header.id) ||
    !validText(header.timestamp, 100) ||
    !validText(header.cwd, 10_000)
  )
    throw new Error("Session import is invalid");
  const entryIds = new Set<string>();
  for (const entry of entries.slice(1)) {
    if (
      !("id" in entry) ||
      !validId(entry.id) ||
      entryIds.has(entry.id) ||
      !("parentId" in entry) ||
      (entry.parentId !== null && !validId(entry.parentId)) ||
      !validEntryShape(entry)
    )
      throw new Error("Session import is invalid");
    entryIds.add(entry.id);
  }
  if (existingIds.has(header.id)) throw new Error("Session already exists");
  return header.id;
}

export async function exportSession(
  session: AgentSession,
  dataDir: string,
  id: string,
  format: "html" | "jsonl",
): Promise<ConversationExport> {
  await mkdir(dataDir, { recursive: true });
  const safeId = id.replaceAll(/[^A-Za-z0-9_-]/g, "").slice(0, 12) || "session";
  const fileName = `conversation-${safeId}.${format}`;
  const outputPath = join(dataDir, `.export-${crypto.randomUUID()}.${format}`);
  try {
    if (format === "html") await session.exportToHtml(outputPath);
    else session.exportToJsonl(outputPath);
    if ((await stat(outputPath)).size > 25_000_000)
      throw new Error("Conversation export is too large");
    const content = await readFile(outputPath);
    return {
      content,
      contentType:
        format === "html"
          ? "text/html; charset=utf-8"
          : "application/x-ndjson; charset=utf-8",
      fileName,
    };
  } finally {
    await unlink(outputPath).catch(() => undefined);
  }
}

export async function withSessionImport<T>(
  dataDir: string,
  content: string,
  importFile: (path: string) => Promise<T>,
): Promise<T> {
  await mkdir(dataDir, { recursive: true });
  const inputPath = join(dataDir, `.import-${crypto.randomUUID()}.jsonl`);
  await writeFile(inputPath, content, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    return await importFile(inputPath);
  } finally {
    await unlink(inputPath).catch(() => undefined);
  }
}
