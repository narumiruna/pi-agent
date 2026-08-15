# Shared Navigation Model Plan

Status: Completed on 2026-08-15.

## Goal

Implement the Phase 0 milestone “讓 desktop sidebar 與 mobile navigation 共用相同的導覽資料與權限判斷” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-0共用基礎與安全邊界).

Desktop and mobile navigation must receive the same ordered, permission-filtered primary items rather than constructing separate route decisions.

## Context

`Navigation.tsx` already reuses one `NavContent` component, but that component currently creates route metadata internally on each render and has no explicit access filter.

The authenticated owner session in `App.tsx` is the existing source of navigation access; this milestone must not invent another authentication or role model.

The target Prompts, Skills, and Extensions routes remain intentionally unavailable until their page milestones are implemented.

## Architecture

Add a pure `src/web/navigation.ts` module containing current primary item metadata and one `primaryNavigationFor()` access function keyed by the existing authenticated session state.

Keep icon components and translations in `Navigation.tsx`, but map them from stable metadata keys.

Compute the filtered items once in the `Navigation` wrapper and pass the same array to desktop and mobile `NavContent` instances.

## Non-Goals

- Do not expose planned routes or remove legacy Library.
- Do not add roles, ACL storage, server APIs, or a second authentication model.
- Do not change route URLs, visible labels, conversation controls, or page contents.

## Risks

An incomplete icon or label mapping can hide a route or break rendering.

An incorrect access default can expose navigation before authentication or leave an authenticated owner without routes.

Mitigate with exact metadata, access, desktop rendering, mobile rendering, and existing E2E coverage.

## Outcome

PR #16 merged as `6013450` after its automatic `verify` check passed.

GitHub reported no submitted reviews, inline comments, conversation comments, or review threads, so no feedback required changes or replies.

The post-merge administrative change checks the matching Roadmap milestone and archives this plan.

## Plan

- [x] Inspect Navigation, App session state, route types, and desktop/mobile tests to define the smallest existing access input.
- [x] Create fresh branch `narumiruna/feat/shared-navigation-model` from current `main` before implementation.
- [x] Add one pure ordered primary-navigation metadata list and authenticated-owner filter; three focused tests verify exact metadata, stable shared reference, denied access, and absent planned routes.
- [x] Pass authenticated state from App and compute one filtered item array for both desktop and mobile NavContent; both component instances receive the same `items` value, while existing App and browser navigation tests preserve rendering and close behavior.
- [x] Run focused tests, `npm run ci`, and desktop/mobile navigation E2E; 46 focused tests passed, CI passed 250 tests with 5 intentional skips and both builds, and all 17 SQLite browser tests passed.
- [x] Review the complete diff for duplicated navigation data, divergent permission decisions, premature route exposure, accessibility regressions, and unrelated changes; one metadata list and filter remain, both surfaces receive one computed array, planned-route scans are empty, browser accessibility passed, no dependency changed, and `git diff --check` passed.
- [x] Commit, push, and open one dedicated signed pull request linking this plan and Roadmap milestone; signed commit `1b6deba` is pushed in PR #16.
- [x] Read all pull-request checks and feedback, fix every actionable item with coverage, and merge the clean pull request; PR #16 `verify` passed, no feedback existed, and merge commit `6013450` is on `main`.
- [x] After merge, check the matching Roadmap milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] One module owns primary navigation order, labels, icon keys, and access requirements.
- [x] Unauthenticated access returns no primary navigation items.
- [x] Authenticated owners receive exactly Chats, Files, Heartbeat, Library, and Settings in current order.
- [x] Desktop and mobile NavContent receive the same filtered item array.
- [x] Prompts, Skills, and Extensions remain unavailable in this milestone.
- [x] Existing conversation controls and mobile close behavior remain unchanged.
- [x] Focused tests, `npm run ci`, and desktop/mobile navigation E2E pass.
- [x] The dedicated pull request is merged with all feedback resolved.
- [x] The Roadmap milestone is checked and this plan is archived only after merge.
