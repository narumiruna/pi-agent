import { describe, expect, test } from "vitest";
import config from "../../vite.config.js";

describe("Vite development proxy", () => {
  test("proxies API routes without intercepting the web API module", () => {
    const prefixes = Object.keys(config.server?.proxy ?? {});
    const isProxied = (path: string) =>
      prefixes.some((prefix) => path.startsWith(prefix));

    expect(isProxied("/api/session")).toBe(true);
    expect(isProxied("/api.ts")).toBe(false);
  });
});
