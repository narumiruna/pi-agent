# Conversation Management and Recovery Plan

Status: Completed on 2026-08-15.

## Goal

Implement the Phase 1 milestone “統一 conversation 管理操作與執行中 session recovery” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-1chats).

Complete one coherent Chats management surface for rename, delete, native tree navigation, fork, clone, compact, import, and export while preserving Pi’s append-only JSONL, runtime replacement lifecycle, active-run isolation, native queues, and reconnect recovery.

## Context

PiService and `ConversationPanel` already expose native tree, fork/clone, compact, import/export, queue, state, and event primitives from earlier runtime work.

The Chats list does not expose rename or delete, inactive rename currently activates the target, and rename/delete are not consistently guarded by the coordinator.

Pi 0.84.1’s selector renames an inactive session with `SessionManager.open(path).appendSessionInfo(name)` and deletes its JSONL only after confirmation.

Pi’s `AgentSessionRuntime` owns session replacement for resume, new, fork, clone, and import, including extension shutdown/start events and cancellation.

The Web restores active run, queue, editor, and extension state from `/state` on initial load, but an EventSource reconnect does not explicitly rehydrate state missed across a disconnect.

## Architecture

Keep `SessionManager`, `AgentSessionRuntime`, `AgentSession`, and the existing API as the only session model.

Add one shared list-row management dialog that can rename any persisted conversation without activating it and can delete only an inactive conversation after explicit confirmation.

Run rename/delete under the existing coordinator so they fail with `agent_busy` instead of racing an active run.

Honor native runtime cancellation for new/resume, and keep fork/import replacement handling on `AgentSessionRuntime`.

On EventSource reconnection, re-fetch the active native state and transcript/list projections so running status, queues, draft, tools, and completed messages recover even when replay cannot cover the gap.

Keep advanced tree, fork/clone, compact, import, and export actions in the existing shared `ConversationPanel`.

## Non-Goals

- Do not add a database conversation model, copy JSONL into app storage, or rewrite native session entries.
- Do not delete the active conversation; users create or switch to another conversation first.
- Do not add bulk management, sharing, remote sync, custom archive formats, or browser-side JSONL parsing.
- Do not expose native paths, raw tree entries, extension state, or import temporary paths.
- Do not replace Pi’s native fork, clone, compaction, import, export, queue, or runtime lifecycle APIs.

## Risks

- Renaming an inactive conversation by switching runtime would silently change the active Chat; append session metadata through an independently opened native manager instead.
- Mutating JSONL during a model run can interleave writes; coordinator admission must reject all management writes while busy.
- A cancelled extension lifecycle hook must not be reported as a successful new, resumed, forked, or imported conversation.
- Deleting the active JSONL can strand the runtime; reject it on both server and Web.
- Event replay can be insufficient after server restart; reconnect must reconcile from authoritative `/state` and transcript APIs.
- Row action controls must not create nested buttons and must remain keyboard- and touch-operable in the 390px drawer.
- Fork/export/list/search must leave original JSONL byte-valid; test native files before and after each read/copy flow.

## Plan

- [x] Inventory existing PiService/API management, native runtime/session APIs, ConversationPanel, queue/reconnect state, tests, translations, and responsive styles.
- [x] Read Pi 0.84.1 sessions, session-format, and compaction docs plus installed runtime/session declarations and implementations.
- [x] Create fresh branch `narumiruna/feat/conversation-management` from current `main` before implementation.
- [x] Make rename/delete coordinator-guarded, rename inactive sessions without activation, and honor native new/resume cancellation.
- [x] Add server regressions for active-run conflicts, inactive rename isolation, active-delete rejection, cancellation, fork switching, JSONL validity, and safe transfer behavior.
- [x] Add a shared accessible conversation management dialog and non-nested per-row action trigger for rename and confirmed inactive delete.
- [x] Reconcile native run, queue, editor, transcript, list, and authoritative active-ID state after EventSource reconnection.
- [x] Add Web regressions for management success/failure, duplicate-submit protection, hidden/active state, and reconnect reconciliation.
- [x] Add desktop and 390px mobile E2E for rename, delete, fork/clone switching, running isolation, queue restoration, reconnect recovery, keyboard focus, overflow, and accessibility.
- [x] Update README with management scope, active-delete rule, native lifecycle, and recovery behavior.
- [x] Run focused tests, `npm run ci`, full E2E, PostgreSQL storage verification, and production Docker build; record exact results.
- [x] Audit native semantic fidelity, JSONL immutability/validity, active-run races, cancellation, path disclosure, stale state, duplicate actions, accessibility, test layout, and unrelated changes.
- [x] Commit, push, and open dedicated pull request [#43](https://github.com/narumiruna/pi-agent/pull/43) with a signed implementation commit linking this plan and Roadmap milestone.
- [x] Resolve every pull-request check and feedback item with regression coverage, then merge clean implementation pull request [#43](https://github.com/narumiruna/pi-agent/pull/43) as `cb29fc2`.
- [x] After merge, check the matching Roadmap milestone and archive this plan through administrative documentation pull request [#44](https://github.com/narumiruna/pi-agent/pull/44).

## Completion Checklist

- [x] Rename works for active and inactive sessions without unintended activation.
- [x] Delete requires confirmation, rejects the active session, and removes only the selected inactive JSONL.
- [x] Tree, fork, clone, compact, import, and export remain native Pi operations behind one shared Chat management surface.
- [x] Fork and clone switch Web and runtime state to the returned native session ID.
- [x] Active runs reject management mutations and retain conversation isolation.
- [x] Native queued messages can be restored after reload/reconnect.
- [x] Event reconnect rehydrates authoritative run, queue, draft, transcript, and list state.
- [x] Original JSONL remains valid after list, search, export, and fork/clone.
- [x] Rename, delete, and fork pass desktop/mobile keyboard, 390px, and accessibility E2E.
- [x] Focused tests, CI, full E2E, PostgreSQL verification, and Docker build pass.
- [x] Dedicated implementation pull request [#43](https://github.com/narumiruna/pi-agent/pull/43) merged as `cb29fc2` with all eight review findings resolved and a clean final review.
- [x] The Roadmap milestone is checked and this plan is archived after the implementation merge.

## Verification

- Focused agent, API, App, and navigation suites: all 135 tests passed.
- `npm run ci`: 27 files passed, 356 tests passed, 6 PostgreSQL-dependent tests skipped locally, and server/Web builds passed.
- `npx playwright test`: all 26 setup, desktop, mobile, management, recovery, and accessibility tests passed.
- The management browser flow renamed active sessions, rejected active deletion, confirmed inactive deletion, switched to native fork and clone IDs, parsed exported JSONL, rejected four mutation classes during a held run, and restored the native queue after reload.
- `TEST_POSTGRES_URL=postgresql://pi_agent:test_password@127.0.0.1:55433/pi_agent npm test -- tests/server/storage.test.ts`: all 14 SQLite/PostgreSQL storage tests passed against a temporary PostgreSQL 17 container.
- `docker build -t pi-agent:local .`: final production image built successfully as `sha256:fcf056cd1e9ae7871574c25342622fe5b2cd7e5ba9153d0d287f63967cc85cfc`.
- Codex review found a server-restart mismatch, stale/permanently-disabled and incomplete or replay-racing reconnect paths, stale activity, and a delete/activate time-of-check race; reconnect now adopts the authoritative server ID with generation cancellation, in-stream retries, replay-versioned state/list/transcript snapshots, recovered editor commands, and transient-state reset, while rename/delete hold the coordinator across lookup and recheck active identity before writing, with ordering, retry, cancellation, and race regressions.
- Native-source and diff audits confirmed inactive rename follows Pi’s selector, runtime replacements honor cancellation, coordinator admission prevents write races, active delete is rejected, JSONL paths stay private, native files remain parseable, reconnect hydrates a valid active ID, and desktop/mobile dialogs avoid nested interactive controls.
- GitHub CI passed with PostgreSQL and production Docker verification, all review threads were resolved, final Codex review on `6a9eb63` reported no major issues, and implementation PR [#43](https://github.com/narumiruna/pi-agent/pull/43) merged as `cb29fc2`.
