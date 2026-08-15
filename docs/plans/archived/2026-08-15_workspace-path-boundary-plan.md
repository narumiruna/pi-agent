# Workspace Path Boundary Plan

Status: Completed on 2026-08-15.

## Goal

Implement the Phase 0 milestone “所有 workspace 路徑都必須經過 `resolve`、`realpath`、containment 與 symlink escape 檢查” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-0共用基礎與安全邊界).

Prove that every workspace list, search, inspect, create, update, rename, delete, and download path stays inside the canonical configured workspace and cannot traverse a symlink.

## Context

The existing `WorkspaceService` and search implementation already route paths through `workspace/policy.ts`.

That policy parses browser-relative paths, canonicalizes the workspace and existing targets, checks containment, walks path segments with `lstat`, rejects symbolic links, and resolves mutation parents.

Current tests cover traversal and direct symlinks, but they do not state the complete operation matrix or directly prove canonical-root and nested-ancestor behavior.

## Architecture

Keep `workspace/policy.ts` as the single path boundary rather than adding route-specific checks.

Exercise `createWorkspaceBoundary`, `resolveWorkspaceTarget`, and `resolveWorkspaceParent` directly for canonical roots, contained targets, excluded paths, traversal, and nested symlink escapes.

Exercise every public `WorkspaceService` path operation against an escaping symlink and verify no outside file is read, changed, linked, renamed, or deleted.

Keep browser contracts workspace-relative and preserve the documented trusted-local-process race boundary.

## Non-Goals

- Do not add workspace roles, mount isolation, an unrestricted filesystem endpoint, or a second path abstraction.
- Do not hide additional files or change content, size, revision, timeout, or download behavior.
- Do not claim protection from a trusted local process racing filesystem operations.
- Do not change APIs outside the configured workspace surface.

## Risks

A test-only change could falsely claim coverage if one public operation is omitted.

Platform-specific path or symlink behavior can make fixtures unreliable.

Over-tightening canonicalization can reject a configured workspace whose root itself is a symlink.

Mitigate with an explicit operation matrix, temporary real directories, a symlinked workspace root, nested escape fixtures, outside-content assertions, and the full existing browser suite.

## Outcome

PR #20 merged as `67241f2` after its automatic `verify` check passed.

GitHub reported no submitted reviews, inline comments, conversation comments, or review threads, so no feedback required changes or replies.

The post-merge administrative change checks the matching Roadmap milestone and archives this plan.

## Plan

- [x] Inventory workspace routes, policy helpers, service/search consumers, and existing traversal and symlink tests; all current paths converge on `workspace/policy.ts`, while canonical-root and complete operation-matrix evidence are missing.
- [x] Create fresh branch `narumiruna/test/workspace-path-boundary` from current `main` before implementation.
- [x] Add direct policy regressions for `resolve`, `realpath`, containment, exclusions, canonical symlink roots, and nested symlink escape rejection; focused tests verify canonical absolute internals while public paths remain relative.
- [x] Add a complete service/search operation matrix proving escaping symlinks cannot read or mutate outside files; list, search, inspect, create, update, rename, delete, and download all reject or skip the fixture, and outside bytes remain unchanged.
- [x] Update the workspace security documentation to name the canonicalization and symlink boundary without expanding its guarantee; README retains the trusted-local-process race warning.
- [x] Run focused server/API tests, `npm run ci`, and local E2E; 49 focused tests passed, CI passed 261 tests with 5 intentional skips and both builds, and all 17 SQLite browser tests passed after correcting the formatting failure reported by the first CI attempt.
- [x] Review the complete diff for uncovered workspace operations, path alias acceptance, outside mutation, content changes, platform assumptions, and unrelated changes; the matrix matches all six service methods plus search, existing alias tests remain, outside bytes and absence are asserted, only tests/docs changed, and `git diff --check` passed.
- [x] Commit, push, and open one dedicated signed pull request linking this plan and Roadmap milestone; signed implementation commit `c5842f1` is on `narumiruna/test/workspace-path-boundary` in PR [#20](https://github.com/narumiruna/pi-agent/pull/20).
- [x] Read all pull-request checks and feedback, fix every actionable item with regression coverage, and merge the clean pull request; PR #20 `verify` passed, no feedback existed, and merge commit `67241f2` is on `main`.
- [x] After merge, check the matching Roadmap milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] The configured workspace is resolved to one canonical real root before target handling.
- [x] Every existing target is segment-walked without following symlinks, canonicalized, and checked for containment.
- [x] Every create or rename destination has a canonical contained parent and a validated basename.
- [x] List, search, inspect, create, update, rename, delete, and download reject nested symlink escapes.
- [x] Rejected operations neither expose outside content nor mutate outside files.
- [x] Workspace responses continue returning only relative paths.
- [x] Focused tests, `npm run ci`, and local E2E pass.
- [x] The dedicated pull request is merged with all feedback resolved.
- [x] The Roadmap milestone is checked and this plan is archived only after merge.
