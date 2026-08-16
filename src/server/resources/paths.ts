import { isAbsolute, relative, resolve, sep } from "node:path";
import { isValidPromptName } from "../../shared/contracts.js";

interface PathOperations {
  isAbsolute(path: string): boolean;
  relative(from: string, to: string): string;
  sep: string;
}

export function isPathContained(
  root: string,
  candidate: string,
  paths: PathOperations = { isAbsolute, relative, sep },
): boolean {
  const child = paths.relative(root, candidate);
  return (
    child === "" ||
    (!paths.isAbsolute(child) &&
      child !== ".." &&
      !child.startsWith(`..${paths.sep}`))
  );
}

export function safeMarkdownPath(directory: string, name: string): string {
  if (!isValidPromptName(name)) {
    throw new Error(
      "Resource name must be a native-compatible prompt name of at most 200 characters",
    );
  }

  const root = resolve(directory);
  const candidate = resolve(root, `${name}.md`);
  if (!isPathContained(root, candidate)) {
    throw new Error("Resource name escapes its directory");
  }
  return candidate;
}
