# App Route Contract Plan

Status: In progress.

## Goal

Implement the Phase 0 milestone “定義 `Chats`、`Files`、`Prompts`、`Skills`、`Extensions`、`Heartbeat` 與 `Settings` 的 route contract” from [`ROADMAP.md`](../../ROADMAP.md#phase-0共用基礎與安全邊界).

Provide one typed, ordered Web route contract with canonical route IDs and paths while retaining the temporary legacy Library route until its later migration milestone.

## Context

At planning time, `src/web/components/Navigation.tsx` owned a private `Page` union containing singular `chat`, `files`, `heartbeat`, `library`, and `settings` values.

`src/web/App.tsx` imported that UI-owned type, and no contract existed for planned Prompts, Skills, or Extensions routes.

This milestone defines identity and canonical paths only; later milestones own shared navigation metadata, browser reload routing, and page implementations.

## Architecture

Add `src/web/routes.ts` as the sole owner of the target route contract, target order, default route, and temporary legacy Library route.

Use plural `chats` as the canonical route ID now while retaining the existing translated “Chat” UI label until the separate Chats rename milestone.

Expose a narrow current `Page` type for rendered routes so planned route IDs cannot put `App` into a blank state before their pages exist.

## Non-Goals

- Do not expose Prompts, Skills, or Extensions in navigation yet.
- Do not add URL history, reload restoration, redirects, or a router dependency.
- Do not rename visible Chat labels or remove Library in this milestone.
- Do not implement resource pages or APIs.

## Risks

Changing internal `chat` to `chats` can break conversation switching or navigation tests if any literal remains.

Mitigate with repository-wide literal scans, focused App tests, and desktop/mobile navigation E2E.

## Plan

- [x] Inspect `App.tsx`, `Navigation.tsx`, i18n, and navigation tests to establish the existing page literals and migration boundary.
- [x] Create fresh branch `narumiruna/feat/app-route-contract` from current `main` before implementation.
- [x] Add a typed route contract for the seven ordered target routes, canonical paths, default route, and separately identified legacy Library route; three focused contract tests verify exact order, uniqueness, path shape, default, and legacy separation.
- [x] Migrate current App and Navigation state from `chat` to canonical `chats` and import the route-owned `Page` type; literal scans found no stale singular page route and focused App tests still render and navigate Chat.
- [x] Run focused route/App tests, `npm run ci`, and navigation E2E; 43 focused tests passed, CI passed 247 tests with 5 intentional skips and both builds, and all 17 SQLite browser tests passed.
- [x] Review the complete diff for blank-page states, accidental early navigation exposure, route drift, dependency additions, and unrelated changes; `Page` excludes planned routes, Navigation exposes no planned literal, contract tests lock exact order, no dependency file changed, and `git diff --check` passed.
- [x] Commit only the plan, contract, integration, and tests with signed Conventional Commits; signed commit `570a962` is pushed in dedicated PR #14 with plan and milestone links.
- [ ] Read all pull-request checks and feedback, address every actionable item with regression coverage, and merge the clean pull request.
- [ ] After merge, check the matching Roadmap milestone and archive this completed plan through an administrative documentation pull request.

## Completion Checklist

- [x] The route contract contains exactly Chats, Files, Prompts, Skills, Extensions, Heartbeat, and Settings in Roadmap order.
- [x] Every target route has one unique lowercase canonical ID and root-relative path.
- [x] Chats is the default route and the active rendered Chat route uses canonical ID `chats`.
- [x] Legacy Library is explicitly separate from the target contract and remains functional.
- [x] Planned resource routes are not exposed before their pages exist.
- [x] Focused tests, `npm run ci`, and desktop/mobile navigation E2E pass.
- [ ] The dedicated pull request is merged with all feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.
