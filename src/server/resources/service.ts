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
import type {
  WebPackageSummary,
  WebPromptTemplateDocument,
} from "../../shared/contracts.js";
import {
  opaquePackageId,
  projectPackageSummary,
  projectResourceProvenance,
} from "../api-metadata.js";
import { atomicWrite } from "./atomic-write.js";
import { safeMarkdownPath } from "./paths.js";

export type DocumentKind = "append" | "heartbeat" | "system" | "template";

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

  async listTemplates(): Promise<WebPromptTemplateDocument[]> {
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
        provenance: projectResourceProvenance({
          scope: "user",
          origin: "top-level",
        }),
      })),
    );
    return documents;
  }

  private packageSourceForId(id: string): string {
    const item = this.packages
      .listConfiguredPackages()
      .find(
        (candidate) =>
          opaquePackageId(candidate.scope, candidate.source) === id,
      );
    if (!item) throw new Error("Package not found");
    return item.source;
  }

  listPackages(): WebPackageSummary[] {
    return this.packages.listConfiguredPackages().map(projectPackageSummary);
  }

  async installPackage(value: string): Promise<void> {
    await this.packages.installAndPersist(packageSource(value));
    await this.reload();
  }

  async removePackage(id: string): Promise<boolean> {
    const removed = await this.packages.removeAndPersist(
      this.packageSourceForId(id),
    );
    if (removed) await this.reload();
    return removed;
  }

  async updatePackage(id?: string): Promise<void> {
    await this.packages.update(id ? this.packageSourceForId(id) : undefined);
    await this.reload();
  }
}
