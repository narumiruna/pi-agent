import type { Page } from "./routes.js";

export type NavigationIconKey =
  | "chat"
  | "file"
  | "heartbeat"
  | "library"
  | "prompt"
  | "settings"
  | "skill";

export type NavigationLabelKey =
  | "chat"
  | "files"
  | "heartbeat"
  | "library"
  | "prompts"
  | "settings"
  | "skills";

export interface PrimaryNavigationItem {
  page: Page;
  labelKey: NavigationLabelKey;
  icon: NavigationIconKey;
  access: "authenticated";
  pulse?: boolean;
}

export const PRIMARY_NAVIGATION_ITEMS = [
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
] as const satisfies readonly PrimaryNavigationItem[];

export function primaryNavigationFor(access: {
  authenticated: boolean;
}): readonly PrimaryNavigationItem[] {
  if (!access.authenticated) return [];
  return PRIMARY_NAVIGATION_ITEMS;
}
