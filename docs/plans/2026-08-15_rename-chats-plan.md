# Rename Chats Plan

Status: In progress.

## Goal

Implement the Phase 1 milestone “將目前「對話」重新命名為 `Chats`，並保留現有 conversation list 與 new-chat 操作” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-1chats).

Rename the current English Chat destination and accessible page region to the plural product label Chats without changing native conversation behavior.

## Context

The route contract and browser path already use the plural `chats` ID and `/chats` path.

The visible navigation item, conversation-list heading, and Chat page region still share the localized `chat` key whose English value is singular “Chat.”

Traditional Chinese already uses the natural localized label “對話.”

The sidebar and mobile drawer already share one navigation model.

Existing conversation list, active selection, and New conversation controls use Pi-backed APIs and have Web/E2E coverage.

## Architecture

Keep the existing `chat` translation key because it consistently labels the destination, region, and list context.

Change only its English display value from `Chat` to `Chats`, retaining the Traditional Chinese localization.

Update semantic and browser assertions to the new accessible name.

Use existing App and chat E2E flows to prove the conversation list, active selection, and New conversation action remain intact.

Do not alter route IDs, paths, SessionManager behavior, conversation APIs, state, or navigation structure.

## Non-Goals

- Do not implement search, filters, sorting, rename, delete, fork, tree, compact, import, or export changes in this milestone.
- Do not rename server API resources or native Pi session concepts.
- Do not add a second translation key or duplicate navigation item.
- Do not change the `/chats` route or invalid-route fallback.

## Risks

Changing an accessible name can break keyboard/browser tests even when the visible label looks correct.

A broad text replacement could accidentally rename internal Chat concepts, API paths, or user-facing phrases that should remain singular.

Localization could regress if the Chinese label is replaced with an untranslated English string.

Mitigate with one translation-value change, targeted semantic assertion updates, a source audit, and full desktop/mobile E2E.

## Plan

- [x] Inventory the route ID, navigation label, page region, conversation list, New conversation action, translations, and matching tests.
- [x] Confirm the existing route and Pi-backed conversation operations already use plural/native contracts and need no migration.
- [x] Create fresh branch `narumiruna/feat/rename-chats` from current `main` before implementation.
- [x] Change the English destination label and page region from Chat to Chats while preserving Traditional Chinese localization.
- [x] Update Web semantic regressions for the plural navigation and region name.
- [x] Update desktop and 390px browser coverage while retaining conversation-list and New conversation assertions.
- [x] Update README terminology for the renamed destination and retained controls.
- [x] Run focused tests, `npm run ci`, full local E2E, and the production Docker build; record exact results.
- [x] Review the complete diff for internal/API renames, route changes, duplicated labels, lost conversation controls, localization regressions, test-layout violations, and unrelated edits.
- [x] Commit, push, and open dedicated pull request [#36](https://github.com/narumiruna/pi-agent/pull/36) with a signed implementation commit linking this plan and Roadmap milestone.
- [ ] Resolve every pull-request check and feedback item with regression coverage, then merge the clean pull request.
- [ ] After merge, check the matching Roadmap milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] English desktop and mobile navigation say Chats.
- [x] The page region and conversation-list context expose the plural accessible label.
- [x] Traditional Chinese retains its localized label.
- [x] The shared navigation model still contains one Chats destination.
- [x] Existing conversation list, selection, and New conversation controls still work.
- [x] Route ID `chats`, path `/chats`, Pi session state, and APIs are unchanged.
- [x] Web, desktop/mobile E2E, CI, and Docker verification pass.
- [ ] The dedicated pull request is merged with all feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.

## Verification

- `npm test -- tests/web/app.test.tsx tests/web/navigation-component.test.tsx tests/web/navigation.test.ts`: 46 tests passed.
- `npm run ci`: 25 files passed, 328 tests passed, 5 PostgreSQL-dependent tests skipped, and both builds passed.
- `npx playwright test`: all 22 setup, desktop, Chats list/new-conversation, accessibility, route, and 390px mobile tests passed.
- `docker build -t pi-agent:local .`: production image built successfully as `sha256:d70d8912d6e44ab9467160af844fb4111dd568a3bbee5f7d29a1ea6bc3562416`.
- A targeted source audit found no remaining exact English accessible label `Chat`; route IDs, paths, API names, and native Pi session operations were unchanged.
