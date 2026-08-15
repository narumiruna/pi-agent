# Navigation Route Recovery Plan

Status: In progress.

## Goal

Satisfy the Phase 0 acceptance milestone “Navigation reload 後會回到有效頁面，失效 route 會安全返回 `Chats`” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#驗收條件).

Give every currently exposed destination a canonical browser path that survives reload, and recover unknown or not-yet-enabled paths to Chats without exposing planned pages.

## Context

The route contract defines target paths, and the current navigation model exposes Chats, Files, Heartbeat, legacy Library, and Settings.

`App` currently stores the selected page only in React state initialized to Chats.

Navigation does not update browser history, direct paths are not parsed, and a reload always loses the selected destination.

The production server serves `index.html` only at `/`, so a browser reload at `/files` or another client route returns 404 before React can recover.

Planned `/prompts`, `/skills`, and `/extensions` paths must remain unavailable until their dedicated phases and therefore currently count as invalid routes.

Files already guards in-app navigation when an editor is dirty; browser history must not bypass that guard.

## Architecture

Derive current page/path parsing from the existing route contract plus the explicit legacy Library route.

Use exact canonical path matching and default to Chats for root, unknown, nested, malformed, and planned-but-disabled paths.

Initialize `App` from `window.location.pathname`, canonicalize invalid locations with `history.replaceState`, push canonical paths for in-app navigation, and react to `popstate`.

Route browser-history changes through the existing Files discard confirmation when an unsaved draft is active.

Add an HTML-only production fallback for non-reserved GET paths while preserving 404/auth behavior for `/api`, `/auth`, `/health`, and `/assets` namespaces.

Verify every current route by direct load and reload, plus invalid and disabled-route recovery, in browser tests under `tests/web/e2e/`.

## Non-Goals

- Do not expose Prompts, Skills, or Extensions before their Roadmap phases.
- Do not add React Router or another routing dependency for five simple pages.
- Do not move conversation IDs or resource IDs into URLs yet.
- Do not serve `index.html` for unknown API, auth, health, asset, or non-HTML requests.
- Do not persist page state in a parallel local-storage setting.

## Risks

A catch-all server route can accidentally turn unknown API requests into HTML 200 responses.

A `popstate` handler that calls `pushState` unconditionally can break Back/Forward navigation loops.

Canonicalization can accidentally discard a valid path or expose a planned route.

Browser history can bypass the dirty Files confirmation if it updates React state directly.

Tests can pass through client-side navigation while missing the production server reload failure.

Mitigate with reserved-prefix and Accept-header tests, pure route parser tests, exact path matching, dirty-history coverage, direct `page.goto()` plus `page.reload()`, and production Docker verification.

## Plan

- [x] Audit the route contract, current navigation model, App page state, Files discard guard, production static serving, and route-related tests.
- [x] Confirm the installed Hono static middleware handler contract before composing an HTML fallback.
- [x] Create fresh branch `narumiruna/feat/navigation-route-recovery` from current `main` before implementation.
- [x] Derive current route IDs and exact path parsing/serialization from the existing route definitions.
- [x] Initialize and canonicalize App location, push paths for navigation, and handle Back/Forward without bypassing dirty Files confirmation.
- [x] Add an HTML-only SPA fallback that excludes reserved server namespaces and non-HTML requests.
- [x] Add server and Web unit regressions for route parsing, canonical fallback, reserved namespaces, and history semantics.
- [x] Add Web E2E coverage for direct load and reload of every current page, invalid-route fallback, disabled planned routes, Back/Forward, and dirty Files history.
- [x] Update README browser-route and fallback documentation.
- [x] Run focused tests, `npm run ci`, full local E2E, and the production Docker build; record exact results.
- [x] Review the complete diff for API fallback leaks, route-contract duplication, planned-route exposure, history loops, dirty-draft loss, query/hash surprises, inaccessible navigation changes, test-layout violations, and unrelated edits.
- [x] Commit, push, and open dedicated pull request [#34](https://github.com/narumiruna/pi-agent/pull/34) with a signed implementation commit linking this plan and Roadmap milestone.
- [ ] Resolve every pull-request check and feedback item with regression coverage, then merge the clean pull request.
- [ ] After merge, check the matching Roadmap acceptance milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] Chats, Files, Heartbeat, Library, and Settings have canonical current paths derived from route definitions.
- [x] Direct load and browser reload preserve every current destination.
- [x] In-app navigation updates browser history, and Back/Forward updates the page.
- [x] Dirty Files history navigation requires explicit discard before leaving.
- [x] Root, unknown, nested, malformed, and planned-but-disabled routes safely replace to `/chats`.
- [x] Unknown reserved namespace and non-HTML requests remain server 404s rather than receiving the SPA.
- [x] No local-storage route state, third-party router, planned page, or duplicate route registry exists.
- [x] Server, Web, E2E, CI, and Docker verification pass.
- [ ] The dedicated pull request is merged with all feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.

## Verification

- `npm test -- tests/web/routes.test.ts tests/web/app.test.tsx tests/server/http-auth.test.ts tests/server/web-fallback.test.ts`: 77 tests passed after review fixes.
- `npm run ci`: 25 files passed, 328 tests passed, 5 PostgreSQL-dependent tests skipped, and both builds passed.
- Initial focused browser runs exposed the intentionally changed post-login canonical URL and a hidden Monaco edit-context selector; the shared sign-in expectation and test interaction were corrected before the full run.
- `npx playwright test`: all 22 setup, desktop, route-reload, OIDC-return, dirty-history, accessibility, and mobile tests passed.
- Direct browser navigation exercises the production `main()` server, proving its HTML fallback rather than only a development-server fallback.
- `docker build -t pi-agent:local .`: post-review production image built successfully as `sha256:07c112d8e1912cdb6aee93e3720b498e87a213791e845694f75999a9ee8cbe8a`.
- Codex reviews identified duplicate history entries around dirty-file confirmation, loss of direct routes through OIDC, and a non-HTML root response that bypassed fallback negotiation; indexed history replays traversal without adding entries, signed shared routes preserve login destinations, and root now uses the same HTML-only handler.
- Browser regressions cover cancel and confirm in both Back and Forward directions, verify preserved history indexes, and prove direct `/files` sign-in returns to `/files`.
