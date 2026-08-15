export interface AppRouteDefinition {
  id: string;
  path: `/${string}`;
}

export const APP_ROUTE_CONTRACT = [
  { id: "chats", path: "/chats" },
  { id: "files", path: "/files" },
  { id: "prompts", path: "/prompts" },
  { id: "skills", path: "/skills" },
  { id: "extensions", path: "/extensions" },
  { id: "heartbeat", path: "/heartbeat" },
  { id: "settings", path: "/settings" },
] as const satisfies readonly AppRouteDefinition[];

export type AppRoute = (typeof APP_ROUTE_CONTRACT)[number]["id"];

export const DEFAULT_APP_ROUTE: AppRoute = "chats";

export const LEGACY_LIBRARY_ROUTE = {
  id: "library",
  path: "/library",
} as const satisfies AppRouteDefinition;

export const CURRENT_PAGE_IDS = [
  "chats",
  "files",
  "heartbeat",
  LEGACY_LIBRARY_ROUTE.id,
  "settings",
] as const satisfies readonly (AppRoute | typeof LEGACY_LIBRARY_ROUTE.id)[];

export type Page = (typeof CURRENT_PAGE_IDS)[number];
