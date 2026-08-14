## Goal

Make subscription authentication, especially OpenAI Codex device-code login in Docker, understandable, recoverable, and usable without reimplementing Pi authentication.

## Context

Pi Core already supports ChatGPT Plus/Pro browser and device-code login, token refresh, and native credential persistence.

The current Web client drops device-code events that contain no message and spreads authentication across a transient notification and generic interaction dialog.

## Architecture

Keep credentials and OAuth execution in Pi `ModelRuntime`.

Add an in-memory, secret-free provider-auth task projection to `PiService`, expose it through REST and SSE for reload recovery, and render it in one Radix authentication dialog.

Continue to use the existing interaction broker for Pi-owned prompts, tagged so authentication prompts are routed to the authentication dialog rather than the generic interaction dialog.

## Non-Goals

- Do not implement or exchange OAuth tokens outside Pi Core.
- Do not persist device codes or authentication task state in SQLite or PostgreSQL.
- Do not automatically change the selected model after login.
- Do not migrate or rewrite existing `auth.json` or `models.json` content.

## Plan

- [x] Add failing server tests for safe provider-auth task state, device-code projection, prompt routing, terminal states, cancellation, recovery, and dismissal; verified 5 expected failures with `npx vitest run tests/server/agent.test.ts tests/server/api.test.ts tests/server/interactions.test.ts` before implementation.
- [x] Add failing Web tests for Codex method selection, device-code display/copy/open, browser/manual-code fallback, terminal states, cancellation, reload recovery, keyboard behavior, and secret absence; verified 5 expected failures with `npx vitest run tests/web/app.test.tsx` before completing copy and behavior.
- [x] Implement the in-memory provider-auth task projection and REST/SSE contracts while preserving Pi-owned credential writes; verified by 37 focused server tests, terminal-state field reduction, and API assertions excluding token secrets.
- [x] Implement the Radix subscription authentication dialog and App/Settings coordination for restore, progress, retry, cancellation, success, reconnect, and explicit model selection; verified by 24 focused Web tests in the full 61-test affected suite.
- [x] Update responsive styles and user documentation for Docker-first device-code login and browser fallback; verified full-width 390px actions, wrapped device codes/URLs, reduced-motion preservation, and README review.
- [x] Run `npm run ci`, SQLite smoke, PostgreSQL smoke, Docker readiness checks, `git diff --check`, and a bounded secret/import/file-size scan; `npm run ci` passed 13 files with 127 passed/5 skipped, both smoke recipes passed, local/public readiness returned ready, public root returned HTTP 200, and unauthenticated provider-auth remained HTTP 401.
- [x] Review the complete diff against the approved behavior, accessibility, compatibility, cancellation, recovery, and data-preservation criteria; no source file exceeds 1,000 lines, no dynamic imports were added, terminal auth state drops codes/URLs, and real OpenAI account exchange remains the accepted unverified path.

## Risks

- A provider may emit an authentication event shape not exercised by Codex; preserve generic Pi prompt and event handling as fallback.
- Browser OAuth loopback callbacks remain unreliable across Docker boundaries; keep device code recommended and retain manual redirect/code entry.
- Process restarts intentionally discard active task state and require a new login attempt, while existing credentials remain untouched.

## Rollback / Recovery

The change adds only in-memory task state and Web/API projections.

Rollback removes the new projection and dialog without changing stored provider credentials.

## Completion Checklist

- [x] Codex device-code login is verified from provider selection through visible code, provider URL, waiting state, and successful model-selection handoff by `tests/web/app.test.tsx`.
- [x] Browser login and manual redirect/code fallback are verified by Web and interaction tests.
- [x] Loading, partial, success, error, expired, cancelled, disabled, retry, dismissal, and reload recovery states are verified by server or Web tests.
- [x] Keyboard labels, focus-managed Radix dialogs, non-color status text, 390px reflow, long-value wrapping, and reduced-motion compatibility are verified by tests and `src/web/styles.css` review.
- [x] API-key, non-Codex OAuth, externally managed credential, disconnect, and current-model preservation behavior pass the full 132-test repository suite.
- [x] No OAuth token, API key, or secret is present in provider-auth REST/SSE projections or the final implementation diff, verified by projection tests, terminal-state reduction, and bounded scans; synthetic test secrets are intentional.
- [x] User documentation explains recommended device-code login, browser fallback, persistence, cancellation, reconnect, and model selection in `README.md`.
- [x] All repository checks and smoke tests pass with evidence recorded; real OpenAI account exchange is explicitly unverified because no external subscription credential was used.
