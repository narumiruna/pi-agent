# Server Boundary Acceptance Plan

Status: In progress.

## Goal

Satisfy the Phase 0 acceptance milestone “未授權路徑、symlink escape、oversized body、stale write 與 active-run conflict 都有 server tests” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#驗收條件).

Provide an auditable server-test matrix for every named path, size, concurrency, and active-run boundary.

## Context

`tests/server/http-auth.test.ts` already verifies authentication on API paths, cross-origin mutation rejection, the global request-body limit, and the dedicated workspace write limit.

`tests/server/workspace.test.ts` already covers one traversal path, every public operation through a symlink escape, stale writes, stale deletes, and concurrent revision races.

`tests/server/resources.test.ts` covers prompt path traversal and symlink replacement but does not directly exercise its one-megabyte document limit.

`tests/server/agent.test.ts` verifies one fork conflict during an active run, while the same `requireIdle()` boundary protects activation, preferences, tree navigation, compaction, export, and import.

The acceptance evidence is therefore strong but uneven: traversal is not table-tested across every public workspace operation, resource body size lacks a direct regression, and active-run coverage samples only one guarded operation.

## Architecture

Keep production boundaries unchanged unless a new regression exposes a defect.

Expand existing matching server suites rather than create a meta-test or duplicate service implementation.

Use table-driven tests against public service methods for traversal and active-run behavior.

Assert both the stable error status/reason or code and the absence of side effects.

Document the exact acceptance category-to-test-file mapping in README.

## Non-Goals

- Do not weaken containment, symlink, body-size, revision, authentication, or coordinator policy.
- Do not add browser coverage for this server-only acceptance milestone.
- Do not inspect private fields or duplicate path-resolution algorithms in tests.
- Do not treat active-run waiting in native reload flows as a conflict when waiting is the intended contract.
- Do not change safe inactive-conversation reads or deletes into conflicts without a demonstrated race.

## Risks

Table-driven tests can appear broad while invoking only validation before meaningful side effects.

Different operations intentionally map traversal and symlink failures differently, so tests must assert their public stable contract rather than one artificial shared status.

An oversized string assertion can accidentally test character count instead of the production byte limit.

Active-run tests can pass for the wrong reason if conversation IDs are invalid or required dependencies are missing before `requireIdle()` runs.

Mitigate with valid operation-shaped inputs, exact public error contracts, multibyte byte-size cases, and spies proving guarded native actions are untouched.

## Plan

- [x] Inventory existing server coverage for authentication/authorization, traversal paths, symlink escapes, global and endpoint body limits, stale revisions, concurrent writes, and active-run conflicts.
- [x] Trace the public WorkspaceService and PiService guards to distinguish conflict, wait, and safe-operation contracts.
- [x] Create fresh branch `narumiruna/test/server-boundary-acceptance` from current `main` before implementation.
- [x] Expand workspace tests so every public path operation rejects unauthorized traversal without touching outside data.
- [x] Add a direct resource-document byte-limit regression proving rejection occurs before persistence and reload.
- [x] Expand active-run tests across every operation protected by `PiService.requireIdle()` and prove native actions are not called.
- [x] Retain and audit existing HTTP oversized-body, symlink-escape, stale-write, stale-delete, and concurrent-revision regressions.
- [x] Document the acceptance test matrix in README.
- [x] Run focused server tests, `npm run ci`, full local E2E, and the production Docker build; record exact results.
- [x] Review the complete diff for missing named boundaries, false-positive tests, wrong public error contracts, side effects before rejection, production behavior changes, test-layout violations, and unrelated edits.
- [x] Commit, push, and open dedicated pull request [#32](https://github.com/narumiruna/pi-agent/pull/32) with a signed test commit linking this plan and Roadmap milestone.
- [ ] Resolve every pull-request check and feedback item with regression coverage, then merge the clean pull request.
- [ ] After merge, check the matching Roadmap acceptance milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] Unauthorized traversal is rejected across list, inspect, create, update, rename, delete, and download operations.
- [x] Symlink escapes remain rejected across every public path operation.
- [x] Global API, workspace payload, and Pi resource document size limits have direct server coverage.
- [x] Stale update/delete and concurrent same-revision writes remain covered.
- [x] All `requireIdle()` operations reject an active run with stable `agent_busy` behavior before native actions.
- [x] Outside files and guarded native actions remain unchanged after rejection.
- [x] No production security boundary is weakened or duplicated.
- [x] Server, CI, E2E, and Docker verification pass.
- [ ] The dedicated pull request is merged with all feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.

## Verification

- `npm test -- tests/server/workspace.test.ts tests/server/resources.test.ts tests/server/agent.test.ts tests/server/http-auth.test.ts`: 80 tests passed.
- `npm run ci`: 24 files passed, 303 tests passed, 5 PostgreSQL-dependent tests skipped, and both builds passed.
- `npx playwright test`: all 19 setup, desktop, accessibility, and mobile tests passed.
- `docker build -t pi-agent:local .`: production image built successfully as `sha256:f9c1f227a46a0a23619037355d507d2525ba73510b5a9ea7ede07e3c1d4e24d2`.
- The diff changes only matching server tests, the acceptance matrix documentation, and this plan; no production boundary code or test layout changed.
