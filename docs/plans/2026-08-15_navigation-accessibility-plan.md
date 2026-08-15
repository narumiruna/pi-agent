# Navigation Accessibility Acceptance Plan

Status: In progress.

## Goal

Satisfy the Phase 0 acceptance milestone “Keyboard、screen reader、visible focus、mobile drawer 與 reduced motion 都能操作所有新入口” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#驗收條件).

Make every currently exposed primary destination operable and understandable with a keyboard, screen reader, visible focus, the 390px drawer, and reduced-motion preferences.

## Context

The shared navigation model currently exposes Chats, Files, Heartbeat, Library, and Settings to authenticated users.

Primary destinations use native buttons and the mobile drawer uses Radix Dialog, but active destinations are represented only with a visual CSS class and the navigation landmark label is not localized.

Global focus-visible styling covers buttons and the current destination controls.

Reduced-motion CSS exists but only targets elements carrying a class, lacks `!important`, and does not reset transition delay.

Desktop accessibility tests visit all primary areas, while current mobile tests exercise only Chats, Files, and Settings and do not prove keyboard activation of every drawer entry or reduced-motion behavior.

## Architecture

Keep the existing single `PRIMARY_NAVIGATION_ITEMS` model and `Navigation` component for desktop and mobile.

Expose the active destination with `aria-current="page"` and localize the primary-navigation landmark.

Strengthen the existing global reduced-motion media query instead of creating JavaScript animation state.

Add component tests for accessible navigation semantics and 390px E2E coverage that iterates the shared current destinations through the drawer using keyboard activation.

Verify focus visibility and focus restoration through computed styles and browser focus state, and verify the active pulse animation is effectively disabled under reduced motion.

## Non-Goals

- Do not expose planned Prompts, Skills, or Extensions routes before their Roadmap phases.
- Do not add a second mobile navigation model or route registry.
- Do not redesign page content or general visual styling.
- Do not emulate a screen reader implementation; use semantic assertions and automated accessibility analysis.
- Do not remove all state change or replace reduced motion with hidden content.

## Risks

Desktop and mobile copies of navigation content can drift if tests use hard-coded implementation-only selectors.

A visually hidden drawer can create duplicate accessible controls if the dialog portal is mounted unexpectedly.

CSS animation overrides can lose to inline declarations or higher specificity.

Focus can be lost when selecting a route closes a controlled dialog and rerenders the workspace.

Mitigate with the shared navigation contract, role/name assertions, universal important reduced-motion overrides, browser focus checks, and full axe coverage.

## Plan

- [x] Inventory all currently exposed primary destinations and their desktop/mobile rendering path.
- [x] Audit native button semantics, Radix Dialog behavior, focus-visible CSS, reduced-motion CSS, and existing Web/E2E accessibility coverage.
- [x] Create fresh branch `narumiruna/feat/navigation-accessibility` from current `main` before implementation.
- [x] Add localized navigation landmark semantics and `aria-current` state for active destinations.
- [x] Strengthen reduced-motion CSS to cover every element and override animation/transition duration and delay safely.
- [x] Add Web component coverage for landmark naming, active-state semantics, native keyboard controls, and mobile dialog state.
- [x] Add 390px E2E coverage that keyboard-activates every primary drawer entry, checks visible focus and focus restoration, and verifies route content.
- [x] Add reduced-motion E2E coverage and run serious accessibility analysis across the mobile drawer flow.
- [x] Update README accessibility guarantees.
- [x] Run focused tests, `npm run ci`, full local E2E, and the production Docker build; record exact results.
- [x] Review the complete diff for inaccessible duplicate navigation, missing destinations, pointer-only handlers, hidden focus, focus loss, motion leaks, localization gaps, route duplication, and unrelated edits.
- [x] Commit, push, and open dedicated pull request [#30](https://github.com/narumiruna/pi-agent/pull/30) with a signed implementation commit linking this plan and Roadmap milestone.
- [ ] Resolve every pull-request check and feedback item with regression coverage, then merge the clean pull request.
- [ ] After merge, check the matching Roadmap acceptance milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] Chats, Files, Heartbeat, Library, and Settings remain sourced from one navigation model.
- [x] Every primary destination is a native keyboard-operable control with localized landmark context.
- [x] The current destination is exposed through `aria-current="page"` on desktop and mobile.
- [x] Every destination has a visible focus indicator.
- [x] The 390px drawer opens, traps focus, activates every destination, closes, and restores focus.
- [x] Reduced-motion preference suppresses navigation animation and transition timing.
- [x] Automated serious accessibility checks pass for the drawer and destinations.
- [x] No planned route is exposed early and no parallel navigation state exists.
- [x] Web, E2E, CI, and Docker verification pass.
- [ ] The dedicated pull request is merged with all feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.

## Verification

- `npm test -- tests/web/navigation-component.test.tsx tests/web/navigation.test.ts`: 5 tests passed.
- `npm run ci`: 24 files passed, 301 tests passed, 5 PostgreSQL-dependent tests skipped, and both builds passed.
- `npx playwright test`: all 19 setup, desktop, accessibility, and 390px mobile tests passed.
- The new mobile acceptance test derives its destination set from `PRIMARY_NAVIGATION_ITEMS`, keyboard-activates all five destinations, verifies dialog focus containment and trigger restoration, checks a 2px focus outline, runs serious axe analysis, and measures reduced-motion timing.
- `docker build -t pi-agent:local .`: production image built successfully as `sha256:f9c1f227a46a0a23619037355d507d2525ba73510b5a9ea7ede07e3c1d4e24d2`.
- Codex review identified that the new browser spec belonged under the repository's Web test area; it moved to `tests/web/e2e/mobile/`, and Playwright plus E2E TypeScript discovery now include that area while still listing exactly 19 intended tests.
