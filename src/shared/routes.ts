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

export const DEFAULT_APP_ROUTE = "chats" as const satisfies AppRoute;

export const LEGACY_LIBRARY_ROUTE = {
  id: "library",
  path: "/library",
} as const satisfies AppRouteDefinition;

export const CURRENT_APP_ROUTES = [
  APP_ROUTE_CONTRACT[0],
  APP_ROUTE_CONTRACT[1],
  APP_ROUTE_CONTRACT[2],
  APP_ROUTE_CONTRACT[5],
  LEGACY_LIBRARY_ROUTE,
  APP_ROUTE_CONTRACT[6],
] as const satisfies readonly AppRouteDefinition[];

export type Page = (typeof CURRENT_APP_ROUTES)[number]["id"];

export const CURRENT_PAGE_IDS: readonly Page[] = CURRENT_APP_ROUTES.map(
  ({ id }) => id,
);

export function isCurrentPagePathname(pathname: string): boolean {
  return CURRENT_APP_ROUTES.some(({ path }) => path === pathname);
}

export function pageFromPathname(pathname: string): Page {
  return (
    CURRENT_APP_ROUTES.find(({ path }) => path === pathname)?.id ??
    DEFAULT_APP_ROUTE
  );
}

export function pathnameForPage(page: Page): `/${string}` {
  return (
    CURRENT_APP_ROUTES.find(({ id }) => id === page)?.path ??
    `/${DEFAULT_APP_ROUTE}`
  );
}
