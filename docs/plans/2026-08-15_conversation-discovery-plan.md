# Conversation Discovery Plan

Status: In progress.

## Goal

Implement the Phase 1 milestone “補齊 conversation 搜尋、named-only filter 與排序” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-1chats).

Bring Pi’s native resume-session discovery semantics to Chats without exposing its searchable session corpus or native paths to the browser.

## Context

The Chats sidebar currently displays the unfiltered `SessionManager.listAll()` projection in native modified-descending order.

The installed Pi 0.84.1 session selector searches ID, optional name, all user/assistant message text, and cwd.

It supports fuzzy terms, quoted exact phrases, `re:<pattern>` regular expressions, an All/Named name filter, and Threaded/Recent/Fuzzy sort labels.

Threaded mode keeps parent sessions before descendants and orders subtrees by latest activity.

Recent mode keeps modified-descending order.

Fuzzy mode orders matching sessions by search score with modified-descending ties.

`SessionInfo` already contains all required private search/tree fields, while the existing API safely returns only opaque IDs, optional names, dates, message counts, and active state.

The active native session can exist in memory before Pi creates a JSONL file, so discovery must synthesize only temporary server-side search metadata for it.

## Architecture

Add a focused server module that faithfully implements the inspected Pi selector query parser, fuzzy scoring, name filtering, and sort semantics over native session records.

Keep `SessionManager.listAll()` and the current heartbeat exclusion as the persisted source.

Represent an unpersisted active `AgentSession` as a temporary server-only discovery record built from its native ID, optional name, current user/assistant messages, workspace, and message timestamps.

Never return `allMessagesText`, cwd, JSONL path, parent path, regex details, or fuzzy score.

Add a bounded validated `GET /api/conversations` query contract:

- `q`: up to 500 characters using Pi fuzzy/phrase/`re:` syntax.
- `name`: `all` or `named`.
- `sort`: `threaded`, `recent`, or `relevance` (displayed as Fuzzy like Pi).

Default to Pi’s All name filter and Threaded sort.

Keep Web filter state in `App`, debounce owner changes, suppress stale responses, and preserve the actual active ID when a filter hides its row.

Render shared desktop/mobile message search, All/Named, and Threaded/Recent/Fuzzy controls with result count, empty state, reset, keyboard focus, and Traditional Chinese labels.

## Non-Goals

- Do not add model/date/scope filters, token-usage sorting, database indexing, pagination, saved search, or a transcript mirror.
- Do not return message text, cwd, JSONL paths, parent paths, or search scores.
- Do not alter Pi JSONL, opaque IDs, SessionManager lifecycle, conversation activation, New conversation, or streaming.
- Do not implement rename/delete/fork/clone/tree/compact/import/export UI or the later session-recovery milestone.
- Do not add a new fuzzy-search dependency or import unsupported Pi package internals.

## Risks

Copying native semantics can drift from the installed Pi version; pin behavior with fixtures derived from the inspected implementation and document the version.

Invalid regex must return no matches rather than throw or execute unbounded work; cap query size and compile once per request.

Parent paths are private and must remain server-only even when used to build threaded ordering.

A malformed parent cycle must not recurse forever or drop all sessions; bound traversal and append unresolved records deterministically.

Filtered results can omit the active session; list state must not select another session or clear Chat state.

Overlapping debounced requests can land out of order; guard every response with a monotonic request number.

Desktop and drawer controls coexist in the DOM; avoid duplicate element IDs and verify 390px overflow, keyboard use, and accessibility.

## Plan

- [x] Inventory SessionManager metadata, active in-memory behavior, current API/Web list flow, translations, styles, and tests.
- [x] Inspect installed Pi 0.84.1 README, session format, `session-selector-search`, `session-selector`, `SessionManager`, and nested Pi TUI fuzzy implementation.
- [x] Incorporate the revised PR-sized Roadmap direction and preserve its dedicated documentation commit.
- [x] Create fresh branch `narumiruna/feat/conversation-discovery` from current `main` before implementation.
- [x] Add pure native-compatible search parsing/scoring, named filtering, recent/relevance/threaded ordering, and cycle-safe private tree handling.
- [x] Extend PiService with persisted plus unpersisted active discovery records while preserving the safe existing response.
- [x] Validate and wire bounded query parameters through the authenticated list API.
- [x] Add server/API regressions for fuzzy terms, phrases, regex and invalid regex, All/Named, each sort/tie, parent trees/cycles, heartbeat exclusion, unpersisted active filtering, and path/message non-disclosure.
- [x] Add debounced race-safe Web query state that preserves the hidden active conversation.
- [x] Add accessible localized shared desktop/mobile search, name filter, native sort controls, counts, empty/reset states, and responsive styles.
- [x] Add Web and browser regressions for search, named-only, all sort controls, hidden-active behavior, retained selection/New conversation, keyboard operation, 390px layout, and no serious accessibility violations.
- [x] Update README with native query syntax/sort semantics and the server-only searchable metadata boundary.
- [x] Run focused tests, `npm run ci`, full local E2E, PostgreSQL storage verification, and the production Docker build; record exact results.
- [x] Review the complete diff for native semantic drift, regex bounds, private metadata leakage, JSONL mutation/duplication, tree cycles, stale races, active-ID corruption, accessibility/responsive regressions, test-layout violations, and unrelated edits.
- [ ] Commit, push, and open one dedicated signed pull request linking this plan and Roadmap milestone.
- [ ] Resolve every pull-request check and feedback item with regression coverage, then merge the clean pull request.
- [ ] After merge, check the matching Roadmap milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] Fuzzy terms, quoted phrases, and `re:` behave like Pi 0.84.1 resume search.
- [x] All/Named filtering uses the native presence-of-trimmed-name rule.
- [x] Threaded, Recent, and Fuzzy sorting match native labels and ordering semantics.
- [x] Persisted active/inactive and unpersisted active sessions remain correct.
- [x] Hidden active rows do not change the active conversation.
- [x] Search corpus, cwd, JSONL/parent paths, and scores remain server-only.
- [x] Controls are keyboard-operable, localized, accessible, and usable at 390px.
- [x] JSONL remains the sole session state and list/search does not mutate it.
- [x] Focused server/Web tests, CI, desktop/mobile E2E, PostgreSQL verification, and Docker build pass.
- [ ] The dedicated pull request is merged with all feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.

## Verification

- Roadmap restructuring PR [#40](https://github.com/narumiruna/pi-agent/pull/40) merged as `497f973` after `verify` passed, two review findings were resolved, and final Codex review found no major issues.
- Focused native discovery, projection, agent, API, App, and navigation suites: 139 tests passed.
- `npm run ci`: 27 files passed, 343 tests passed, 6 PostgreSQL-dependent tests skipped locally, and both server/Web builds passed.
- `npx playwright test`: all 23 setup, desktop native-discovery, owner-flow, accessibility, route, and 390px mobile tests passed.
- `TEST_POSTGRES_URL=postgresql://pi_agent:test_password@127.0.0.1:55433/pi_agent npm test -- tests/server/storage.test.ts`: all 14 SQLite/PostgreSQL storage tests passed against a temporary PostgreSQL 17 container.
- `docker build -t pi-agent:local .`: production image built successfully as `sha256:31f05ef5fb4efd72c3fe948565b878d07a5a8b5a0fa1ebc313e9a2ad5874433c`.
- Source/API/browser audits confirmed native query/sort semantics, 500-character query bounds, cycle-safe threading, stale-response suppression, hidden-active preservation, byte-identical JSONL after search, and no private search/tree metadata projection.
