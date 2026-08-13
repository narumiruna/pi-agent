import { resolve } from "node:path";

const SAFE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function safeMarkdownPath(directory: string, name: string): string {
  if (!SAFE_NAME.test(name)) {
    throw new Error(
      "Resource name must be a lowercase slug of at most 64 characters",
    );
  }

  const root = resolve(directory);
  const candidate = resolve(root, `${name}.md`);
  if (!candidate.startsWith(`${root}/`)) {
    throw new Error("Resource name escapes its directory");
  }
  return candidate;
}
