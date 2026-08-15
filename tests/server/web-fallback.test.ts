import { describe, expect, test } from "vitest";
import { shouldServeWebApp } from "../../src/server/web-fallback.js";

describe("Web navigation fallback", () => {
  test.each([
    "/",
    "/chats",
    "/files",
    "/heartbeat",
    "/library",
    "/settings",
    "/unknown",
    "/nested/unknown",
  ])("serves index.html for browser navigation to %s", (pathname) => {
    expect(
      shouldServeWebApp(
        pathname,
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ),
    ).toBe(true);
  });

  test.each([
    "/api",
    "/api/unknown",
    "/assets/missing.js",
    "/auth/unknown",
    "/health/unknown",
  ])("preserves the reserved server namespace for %s", (pathname) => {
    expect(shouldServeWebApp(pathname, "text/html")).toBe(false);
  });

  test("does not turn non-HTML requests into SPA responses", () => {
    expect(shouldServeWebApp("/files", undefined)).toBe(false);
    expect(shouldServeWebApp("/files", "application/json, */*")).toBe(false);
    expect(shouldServeWebApp("/files", "text/html;q=0, application/json")).toBe(
      false,
    );
  });

  test("matches reserved prefixes only on path-segment boundaries", () => {
    expect(shouldServeWebApp("/apiary", "text/html")).toBe(true);
    expect(shouldServeWebApp("/assets-old", "text/html")).toBe(true);
  });
});
