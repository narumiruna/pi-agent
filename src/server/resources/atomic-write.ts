import {
  link,
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

async function writeDirectory(
  path: string,
  expectedParent?: string,
): Promise<string> {
  const directory = dirname(path);
  if (!expectedParent) await mkdir(directory, { recursive: true });
  const actual = await realpath(directory);
  if (expectedParent && actual !== resolve(expectedParent))
    throw new Error("Resource parent changed before persistence");
  return actual;
}

async function assertTemporaryParent(
  temporary: string,
  expectedParent: string,
): Promise<void> {
  const actual = dirname(await realpath(temporary));
  if (actual !== expectedParent)
    throw new Error("Resource parent changed during persistence");
}

export async function atomicCreate(
  path: string,
  content: string,
  expectedParent: string,
  mode = 0o600,
): Promise<void> {
  const directory = await writeDirectory(path, expectedParent);
  const destination = join(directory, basename(path));
  const temporary = join(directory, `.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode });
    await assertTemporaryParent(temporary, directory);
    await writeDirectory(destination, directory);
    await link(temporary, destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export interface ExpectedFileIdentity {
  dev: number;
  ino: number;
  birthtimeMs: number;
  ctimeMs: number;
  size: number;
}

function matchesExpectedFile(
  current: Awaited<ReturnType<typeof lstat>>,
  expected: ExpectedFileIdentity,
  includeChangeTime: boolean,
): boolean {
  return (
    !current.isSymbolicLink() &&
    current.isFile() &&
    current.nlink === 1 &&
    current.dev === expected.dev &&
    current.ino === expected.ino &&
    current.birthtimeMs === expected.birthtimeMs &&
    (!includeChangeTime || current.ctimeMs === expected.ctimeMs) &&
    current.size === expected.size
  );
}

async function restoreMovedFile(
  backup: string,
  destination: string,
): Promise<void> {
  try {
    await link(backup, destination);
    await rm(backup);
  } catch {
    // Preserve the moved file at its private backup path if the name was reused.
  }
}

export async function atomicWrite(
  path: string,
  content: string,
  mode = 0o600,
  expectedParent?: string,
  expectedTarget?: ExpectedFileIdentity,
): Promise<void> {
  const directory = await writeDirectory(path, expectedParent);
  const destination = join(directory, basename(path));
  const temporary = join(directory, `.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode });
    await assertTemporaryParent(temporary, directory);
    await writeDirectory(destination, directory);
    if (expectedTarget) {
      const backup = join(directory, `.${crypto.randomUUID()}.bak`);
      let moved = false;
      let published = false;
      try {
        const beforeMove = await lstat(destination).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            throw new Error("Resource not found");
          throw error;
        });
        if (!matchesExpectedFile(beforeMove, expectedTarget, true))
          throw new Error("Resource changed before persistence");
        try {
          await rename(destination, backup);
          moved = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            throw new Error("Resource not found");
          throw error;
        }
        const current = await lstat(backup);
        if (!matchesExpectedFile(current, expectedTarget, false))
          throw new Error("Resource changed before persistence");
        try {
          await link(temporary, destination);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST")
            throw new Error("Resource changed before persistence");
          throw error;
        }
        published = true;
        await rm(temporary);
        await rm(backup);
        return;
      } catch (error) {
        if (moved && !published) await restoreMovedFile(backup, destination);
        throw error;
      }
    }
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
