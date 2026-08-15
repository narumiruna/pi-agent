# Prompts Page Migration Plan

Status: Completed on 2026-08-15.

## Goal

Implement the Phase 3 milestone “建立 `Prompts` 頁面並遷移 system prompt 與 template CRUD” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-3prompts).

Move the existing global `SYSTEM.md`, `APPEND_SYSTEM.md`, and user prompt-template management from Library into a dedicated desktop/mobile Prompts destination without changing files, API contracts, or Pi reload behavior.

## Context

Library currently combines global system prompt editors, user template CRUD, Pi package management, and MCP settings.

`ResourceService` already reads and atomically writes `~/.pi/agent/SYSTEM.md`, `APPEND_SYSTEM.md`, and non-recursive `prompts/*.md`, rejects unsafe names and symlinks, enforces the one-megabyte document limit, and invokes native `AgentSession.reload()` after mutations.

The shared route contract already reserves `/prompts`, but current routing and navigation intentionally omit it.

Pi 0.84.1 loads global system prompt files from `~/.pi/agent`, global templates from `~/.pi/agent/prompts/*.md`, and templates as `/filename` commands.

Existing data therefore needs no migration or parallel resource model.

## Architecture

Add `/prompts` to the current shared route and primary navigation models in Roadmap order.

Extract the existing system/append editors and user-template CRUD into `PromptsPage`, preserving `/api/documents/:kind` and `/api/templates/:name` as the sole persistence boundary.

Keep Library available during later migrations, but reduce it to its remaining package and MCP responsibilities.

Use the same Prompts page component on desktop and in the 390px drawer, with explicit labels, pending-state duplicate protection, mutation feedback, keyboard focus, and responsive tab/list layout.

Keep all writes on `ResourceService`, so atomic replacement, safe paths, existing files, native reload, and API validation remain unchanged.

## Non-Goals

- Do not add project, package, settings-added, or temporary prompt discovery in this milestone.
- Do not add prompt provenance detail, read-only permission rules, validation diagnostics, collision reporting, or autocomplete reload assertions reserved for the next two milestones.
- Do not move package or MCP controls out of Library yet.
- Do not rename, convert, copy, or delete existing `SYSTEM.md`, `APPEND_SYSTEM.md`, or `prompts/*.md` files.
- Do not create a database prompt model, browser-local prompt store, or second reload mechanism.

## Risks

- Rendering prompt controls in both Library and Prompts would create duplicate ownership; remove them from Library in the same change.
- Route activation can break Back/Forward or mobile drawer behavior; update the shared route/navigation contracts and matching route E2E.
- Fire-and-forget mutations permit duplicate writes and silent failure; await each mutation, disable only its affected controls, and surface success/failure.
- Editing a template under a new name can accidentally leave the original file; preserve current create/update semantics and make the selected name explicit.
- Mobile tab rows and template actions can overflow at 390px; use wrapping layouts and verify viewport width.
- Migration must not alter native files or reload lifecycle; pin persistence and reload behavior with existing server tests and browser filesystem assertions.

## Plan

- [x] Inventory Library prompt/package/MCP responsibilities, shared routes/navigation, ResourceService/API contracts, existing Web/server/E2E coverage, and responsive styles.
- [x] Read Pi 0.84.1 prompt-template, system-prompt, project-trust, and security documentation.
- [x] Create fresh branch `narumiruna/feat/prompts-page` from merged `main` and add this dedicated plan before implementation.
- [x] Add Prompts to current route/navigation models, localization, desktop sidebar, mobile drawer, and canonical Back/Forward handling.
- [x] Extract system/append editors and user-template CRUD into a dedicated accessible `PromptsPage` with pending and feedback states.
- [x] Remove prompt ownership from Library while preserving package and MCP behavior and route compatibility.
- [x] Add/update Web regressions for route/navigation order, document load/save failure, template create/edit/delete, duplicate-submit protection, and Library isolation.
- [x] Move desktop persistence E2E to Prompts and add 390px mobile keyboard, CRUD, overflow, and accessibility coverage.
- [x] Update README route and resource-management documentation without claiming later discovery/diagnostic scope.
- [x] Run focused tests, `npm run ci`, full E2E, PostgreSQL storage verification, and production Docker build; record exact results.
- [x] Audit unchanged API/files, native reload reuse, no duplicate prompt UI/state, route history, errors, accessibility, responsive layout, and unrelated changes.
- [x] Commit, push, and merge dedicated pull request [#45](https://github.com/narumiruna/pi-agent/pull/45) as `d818ae5` after required checks and a clean final review.
- [x] After merge, check the matching Roadmap milestone and archive this plan through administrative documentation pull request [#46](https://github.com/narumiruna/pi-agent/pull/46).

## Completion Checklist

- [x] `/prompts` is canonical and available from desktop and mobile navigation in Roadmap order.
- [x] Prompts owns global system, append-system, and user-template CRUD; Library no longer duplicates those controls.
- [x] Existing native files remain in place and persist across reload with no conversion.
- [x] ResourceService remains the only write/reload path and existing API contracts remain compatible.
- [x] Mutation controls reject duplicate submission and expose actionable success/failure state.
- [x] Desktop and 390px keyboard/E2E flows cover system save and template create/edit/delete without overflow or serious accessibility violations.
- [x] Focused tests, CI, full E2E, PostgreSQL verification, and Docker build pass.
- [x] Dedicated implementation pull request [#45](https://github.com/narumiruna/pi-agent/pull/45) merged as `d818ae5` with required checks passing and no review findings.
- [x] The Roadmap milestone is checked and this plan is archived after the implementation merge.

## Verification

- Focused API, ResourceService, fallback, Prompts, Library, route, navigation-model, and navigation-component suites passed all 89 tests.
- `npm run ci` passed: 28 files, 360 tests passed, 6 PostgreSQL-dependent tests skipped locally, TypeScript E2E checking passed, and server/Web builds passed.
- `npx playwright test` passed all 28 setup, desktop, mobile, route, prompt CRUD, accessibility, and existing-regression tests.
- Desktop E2E saved and reloaded the existing global `SYSTEM.md`, created and updated the same native user template file, then deleted it; Library retained only package and MCP controls.
- The 390px keyboard flow saved system instructions, created, edited, and deleted a template, retained visible keyboard operation, had no horizontal viewport overflow, and passed the serious-impact accessibility scan.
- `TEST_POSTGRES_URL=postgresql://pi_agent:test_password@127.0.0.1:55433/pi_agent npm test -- tests/server/storage.test.ts` passed all 14 SQLite/PostgreSQL storage tests against a temporary PostgreSQL 17 container.
- `docker build -t pi-agent:local .` built production image `sha256:191b8501e6dd2429527243ec72a7c68ad7920418995f0de24f49acfef677be55`.
- Diff and source audits confirmed no resource API or file-layout changes, all writes still use `ResourceService` atomic write plus native reload, `/prompts` participates in canonical history, Library no longer requests prompt data, and later prompt discovery/diagnostic scope remains unimplemented.
- GitHub CI passed with PostgreSQL and production Docker verification, final Codex review on `2453a46` found no major issues, and implementation PR [#45](https://github.com/narumiruna/pi-agent/pull/45) merged as `d818ae5`.
