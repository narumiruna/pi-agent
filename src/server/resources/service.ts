import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PackageManager } from "@earendil-works/pi-coding-agent";
import { atomicWrite } from "./atomic-write.js";
import { safeMarkdownPath } from "./paths.js";

export type DocumentKind = "append" | "heartbeat" | "system" | "template";

export interface TemplateDocument {
  name: string;
  content: string;
}

export interface PackageSummary {
  source: string;
  scope: "project" | "user";
  filtered: boolean;
  installedPath?: string;
}

type PackageOperations = Pick<
  PackageManager,
  "installAndPersist" | "listConfiguredPackages" | "removeAndPersist" | "update"
>;

function packageSource(value: string): string {
  const source = value.trim();
  if (source.length < 1 || source.length > 2_048 || /[\r\n\0]/.test(source)) {
    throw new Error("Package source is invalid");
  }
  if (!/^(?:npm:|git:|https?:\/\/|ssh:\/\/|\/|\.{1,2}\/)/.test(source)) {
    throw new Error(
      "Package source must be npm, git, URL, or a relative or absolute container path",
    );
  }
  return source;
}

export class ResourceService {
  private readonly promptDir: string;

  constructor(
    private readonly agentDir: string,
    private readonly packages: PackageOperations,
    private readonly reload: () => Promise<void>,
  ) {
    this.promptDir = join(agentDir, "prompts");
  }

  private documentPath(kind: DocumentKind, name?: string): string {
    if (kind === "template") {
      if (!name) throw new Error("Template name is required");
      return safeMarkdownPath(this.promptDir, name);
    }
    if (name) throw new Error("This document does not accept a name");
    return join(
      this.agentDir,
      kind === "system"
        ? "SYSTEM.md"
        : kind === "append"
          ? "APPEND_SYSTEM.md"
          : "HEARTBEAT.md",
    );
  }

  private async assertSafeParent(path: string): Promise<void> {
    await mkdir(this.agentDir, { recursive: true });
    await mkdir(resolve(path, ".."), { recursive: true });
    const [root, parent] = await Promise.all([
      realpath(this.agentDir),
      realpath(resolve(path, "..")),
    ]);
    if (parent !== root && !parent.startsWith(`${root}/`))
      throw new Error("Resource path escapes the agent directory");
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink())
        throw new Error("Resource file cannot be a symbolic link");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async readDocument(
    kind: DocumentKind,
    name?: string,
  ): Promise<string | undefined> {
    const path = this.documentPath(kind, name);
    await this.assertSafeParent(path);
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async writeDocument(
    kind: DocumentKind,
    name: string | undefined,
    content: string,
  ): Promise<void> {
    if (Buffer.byteLength(content) > 1_000_000)
      throw new Error("Document is too large");
    const path = this.documentPath(kind, name);
    await this.assertSafeParent(path);
    await atomicWrite(path, content);
    await this.reload();
  }

  async deleteDocument(kind: DocumentKind, name?: string): Promise<void> {
    const path = this.documentPath(kind, name);
    await this.assertSafeParent(path);
    await rm(path, { force: true });
    await this.reload();
  }

  async listTemplates(): Promise<TemplateDocument[]> {
    await mkdir(this.promptDir, { recursive: true });
    const entries = await readdir(this.promptDir, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name.slice(0, -3))
      .sort();
    const documents = await Promise.all(
      names.map(async (name) => ({
        name,
        content: (await this.readDocument("template", name)) ?? "",
      })),
    );
    return documents;
  }

  listPackages(): PackageSummary[] {
    return this.packages.listConfiguredPackages().map((item) => ({
      source: item.source,
      scope: item.scope,
      filtered: item.filtered,
      ...(item.installedPath ? { installedPath: item.installedPath } : {}),
    }));
  }

  async installPackage(value: string): Promise<void> {
    await this.packages.installAndPersist(packageSource(value));
    await this.reload();
  }

  async removePackage(value: string): Promise<boolean> {
    const removed = await this.packages.removeAndPersist(packageSource(value));
    if (removed) await this.reload();
    return removed;
  }

  async updatePackage(value?: string): Promise<void> {
    await this.packages.update(value ? packageSource(value) : undefined);
    await this.reload();
  }
}
