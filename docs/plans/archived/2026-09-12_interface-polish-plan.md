# Interface Polish

## Goal

Give the existing Web UI a cohesive, calm visual hierarchy without changing native Pi behavior or adding dependencies.

## Plan

- [x] Inspect the Web layout, installed component APIs, translations, and browser test harness; confirmed Radix Themes and existing desktop/mobile Playwright coverage.
- [x] Refine `src/web/styles.css`, navigation, and login presentation with consistent typography, accessible teal accents, surfaces, and responsive spacing; reviewed six generated browser screenshots.
- [x] Add localized chat starter cards that append to and focus the existing composer without sending or replacing a draft; `tests/web/chat-welcome.test.tsx` covers enabled/disabled states, draft preservation, focus, no send, and English/Traditional Chinese content.
- [x] Validate light/dark and desktop/mobile layouts, keyboard access, and existing user flows with Playwright; the full 33-test Chromium suite passes with deterministic E2E credentials.

## Completion Checklist

- [x] `npm run ci` passes: 481 Vitest tests passed and 6 PostgreSQL contract tests skipped because `TEST_POSTGRES_URL` was not set.
- [x] Focused browser tests pass; reviewed desktop light/dark, mobile light/dark, mobile navigation, and login screenshots for overflow, WCAG contrast, starter visibility, and composer placement.
- [x] Review the final diff for unintended functionality or dependency changes; changes remain in the Web presentation/test boundary, preserve Pi-backed chat behavior, and add no dependencies.
