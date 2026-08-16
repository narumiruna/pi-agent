import { describe, expect, test } from "vitest";
import {
  APP_ROUTE_CONTRACT,
  CURRENT_APP_ROUTES,
  CURRENT_PAGE_IDS,
  DEFAULT_APP_ROUTE,
  isCurrentPagePathname,
  LEGACY_LIBRARY_ROUTE,
  pageFromPathname,
  pathnameForPage,
} from "../../src/web/routes.js";

describe("app route contract", () => {
  test("defines the seven target routes in roadmap order", () => {
    expect(APP_ROUTE_CONTRACT).toEqual([
      { id: "chats", path: "/chats" },
      { id: "files", path: "/files" },
      { id: "prompts", path: "/prompts" },
      { id: "skills", path: "/skills" },
      { id: "extensions", path: "/extensions" },
      { id: "heartbeat", path: "/heartbeat" },
      { id: "settings", path: "/settings" },
    ]);
  });

  test("uses unique lowercase IDs and canonical root paths", () => {
    const ids = APP_ROUTE_CONTRACT.map(({ id }) => id);
    const paths = APP_ROUTE_CONTRACT.map(({ path }) => path);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
    for (const route of APP_ROUTE_CONTRACT) {
      expect(route.id).toMatch(/^[a-z]+$/);
      expect(route.path).toBe(`/${route.id}`);
    }
  });

  test("parses and serializes every current canonical route", () => {
    expect(CURRENT_APP_ROUTES).toEqual([
      { id: "chats", path: "/chats" },
      { id: "files", path: "/files" },
      { id: "prompts", path: "/prompts" },
      { id: "skills", path: "/skills" },
      { id: "heartbeat", path: "/heartbeat" },
      { id: "library", path: "/library" },
      { id: "settings", path: "/settings" },
    ]);
    for (const route of CURRENT_APP_ROUTES) {
      expect(isCurrentPagePathname(route.path)).toBe(true);
      expect(pageFromPathname(route.path)).toBe(route.id);
      expect(pathnameForPage(route.id)).toBe(route.path);
    }
  });

  test.each(["/", "/unknown", "/nested/unknown", "/files/", "/extensions"])(
    "safely maps invalid or unavailable path %s to Chats",
    (pathname) => {
      expect(isCurrentPagePathname(pathname)).toBe(false);
      expect(pageFromPathname(pathname)).toBe("chats");
    },
  );

  test("defaults to Chats and keeps Library outside the target contract", () => {
    expect(DEFAULT_APP_ROUTE).toBe("chats");
    expect(LEGACY_LIBRARY_ROUTE).toEqual({
      id: "library",
      path: "/library",
    });
    expect(APP_ROUTE_CONTRACT.map(({ id }) => id)).not.toContain("library");
    expect(CURRENT_PAGE_IDS).toEqual([
      "chats",
      "files",
      "prompts",
      "skills",
      "heartbeat",
      "library",
      "settings",
    ]);
  });
});
