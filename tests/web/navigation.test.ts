import { describe, expect, test } from "vitest";
import {
  PRIMARY_NAVIGATION_ITEMS,
  primaryNavigationFor,
} from "../../src/web/navigation.js";

describe("primary navigation model", () => {
  test("defines current primary items in one stable order", () => {
    expect(PRIMARY_NAVIGATION_ITEMS).toEqual([
      {
        page: "chats",
        labelKey: "chat",
        icon: "chat",
        access: "authenticated",
      },
      {
        page: "files",
        labelKey: "files",
        icon: "file",
        access: "authenticated",
      },
      {
        page: "prompts",
        labelKey: "prompts",
        icon: "prompt",
        access: "authenticated",
      },
      {
        page: "skills",
        labelKey: "skills",
        icon: "skill",
        access: "authenticated",
      },
      {
        page: "heartbeat",
        labelKey: "heartbeat",
        icon: "heartbeat",
        access: "authenticated",
        pulse: true,
      },
      {
        page: "library",
        labelKey: "library",
        icon: "library",
        access: "authenticated",
      },
      {
        page: "settings",
        labelKey: "settings",
        icon: "settings",
        access: "authenticated",
      },
    ]);
  });

  test("returns the shared items only for an authenticated session", () => {
    expect(primaryNavigationFor({ authenticated: true })).toBe(
      PRIMARY_NAVIGATION_ITEMS,
    );
    expect(primaryNavigationFor({ authenticated: false })).toEqual([]);
  });

  test("exposes Prompts and Skills but not later planned resource routes", () => {
    const pages = primaryNavigationFor({ authenticated: true }).map(
      ({ page }) => page,
    );
    expect(pages).toContain("prompts");
    expect(pages).toContain("skills");
    expect(pages).not.toContain("extensions");
  });
});
