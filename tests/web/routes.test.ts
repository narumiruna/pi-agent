import { describe, expect, test } from "vitest";
import {
  APP_ROUTE_CONTRACT,
  CURRENT_PAGE_IDS,
  DEFAULT_APP_ROUTE,
  LEGACY_LIBRARY_ROUTE,
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
      "heartbeat",
      "library",
      "settings",
    ]);
  });
});
