# Native Conversation Storage Plan

Status: In progress.

## Goal

Implement the Phase 1 milestone “沿用 `SessionManager` 與目前的 opaque conversation ID，不複製 JSONL session state” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-1chats).

Prove and document that Pi’s `SessionManager` and native JSONL files remain the sole conversation source of truth, with opaque IDs at the Web boundary and no mirrored conversation persistence in the app database.

## Context

`PiService` already creates, resumes, lists, opens, and switches conversations through Pi’s installed `SessionManager` and `AgentSession` APIs.

Conversation list responses project native session IDs and safe metadata without exposing server paths.

Inactive transcript reads resolve an ID to a native session path on the server before calling `SessionManager.open`.

The app stores only owner identity, Web sessions, and heartbeat run records in SQLite/PostgreSQL; normal conversation content remains native JSONL under the Pi agent directory.

Existing tests cover active in-memory sessions and API path redaction, but they do not directly pin native list projection, opaque ID-to-path resolution, or the absence of conversation tables in the local app database.

## Architecture

Keep `SessionManager.listAll()` as the list source and retain heartbeat-session filtering.

Treat each native `session.id` as an opaque exact-match token; do not parse its format, derive a path from it, or expose the resolved path.

Resolve list IDs against current native records, then pass only the matched server-side path into Pi’s `switchSession`/`SessionManager.open` APIs.

Keep transient unsaved active sessions as a Web list projection only; Pi persists them through its own lifecycle.

Keep SQLite/PostgreSQL focused on app ownership, Web authentication sessions, and heartbeat run history; do not add a conversation table, transcript column, or JSONL copy.

## Non-Goals

- Do not change Pi JSONL format, location, naming, retention, or migration behavior.
- Do not create a conversation repository, ORM model, cache, index, or database schema.
- Do not replace native IDs with app-generated UUIDs or expose native filesystem paths.
- Do not implement Phase 1 search, filters, sorting, rename, delete, fork, compact, import, or export changes.
- Do not modify heartbeat’s dedicated native session behavior.

## Risks

An assertion that only checks an ID-shaped fixture could accidentally encode UUID assumptions rather than opacity.

A list test that mocks `PiService.nativeSessions` would not prove use of `SessionManager.listAll()`.

A database-schema assertion can become noisy if legitimate app metadata tables are added later, so it should assert the absence of conversation/session-content storage rather than freeze every table forever.

Static documentation alone can drift; pair it with native projection, activation, API redaction, and SQLite schema regressions.

## Plan

- [x] Inventory PiService list/create/activate/transcript/import/export behavior, shared contracts, API projections, SQLite/PostgreSQL schemas, README architecture, and tests.
- [x] Inspect the installed Pi `SessionManager` API used by the current implementation and confirm the project does not maintain a parallel conversation abstraction.
- [x] Create fresh branch `narumiruna/test/native-conversation-storage` from current `main` before changes.
- [x] Add a service regression proving `listConversations()` projects current `SessionManager.listAll()` records, excludes heartbeat records, preserves an unusual opaque ID exactly, and omits native paths.
- [x] Add an activation regression proving an opaque ID is exact-matched to the current native record and only its resolved path reaches Pi runtime switching.
- [x] Add a SQLite migration regression proving no normal-conversation, transcript, or JSONL-copy table is created.
- [x] Clarify the source-of-truth and database boundary in README without inventing a second storage layer.
- [x] Run focused tests, `npm run ci`, full local E2E, and the production Docker build; record exact results.
- [x] Review the complete diff for ID parsing, path exposure, copied JSONL state, schema drift, private-API coupling, test-layout violations, and unrelated edits.
- [x] Commit, push, and open dedicated pull request [#38](https://github.com/narumiruna/pi-agent/pull/38) with a signed commit linking this plan and Roadmap milestone.
- [ ] Resolve every pull-request check and feedback item with regression coverage, then merge the clean pull request.
- [ ] After merge, check the matching Roadmap milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] `SessionManager.listAll()` remains the normal conversation list source.
- [x] Native session IDs cross the Web boundary unchanged and are treated as opaque.
- [x] Native paths remain server-side and are resolved only from current Pi records.
- [x] Heartbeat JSONL remains excluded from the normal Chats list.
- [x] The app database contains no normal conversation/transcript/JSONL mirror table.
- [x] README describes Pi JSONL as the sole conversation source of truth in both database modes.
- [x] Focused service/storage/API tests, CI, E2E, and Docker verification pass.
- [ ] The dedicated pull request is merged with all feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.

## Verification

- Installed `@earendil-works/pi-coding-agent` 0.84.1 README, session-format documentation, declarations, implementation, and exports confirm `SessionManager` owns append-only JSONL, native IDs, `listAll`, `open`, and runtime switching contracts.
- `npm test -- tests/server/native-conversations.test.ts tests/server/storage.test.ts tests/server/api.test.ts`: 47 tests passed and 6 PostgreSQL-dependent tests skipped.
- `TEST_POSTGRES_URL=postgresql://pi-agent:test-password@127.0.0.1:55432/pi-agent npm test -- tests/server/storage.test.ts`: all 14 SQLite/PostgreSQL storage tests passed against a temporary PostgreSQL 17 container.
- `npm run ci`: 26 files passed, 331 tests passed, 6 PostgreSQL-dependent tests skipped, and both builds passed locally; pull-request CI runs all PostgreSQL cases.
- `npx playwright test`: all 22 setup, desktop, Chats, accessibility, route, and 390px mobile tests passed.
- `docker build -t pi-agent:local .`: production image built successfully as `sha256:d70d8912d6e44ab9467160af844fb4111dd568a3bbee5f7d29a1ea6bc3562416`.
- Source and schema audits found no conversation/transcript/JSONL mirror in either app store, no parsing of conversation IDs, and no Web projection of native paths.
- Codex reviews identified a weak exact-ID fixture, an over-broad SQLite table assertion, missing PostgreSQL catalog coverage, and missing inactive-list coverage; prefixed decoys prove target selection, active and inactive native records are both projected, targeted checks permit unrelated metadata tables, and equivalent SQLite/PostgreSQL regressions enforce both database modes.
