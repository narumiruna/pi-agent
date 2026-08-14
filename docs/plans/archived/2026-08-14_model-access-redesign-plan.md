## Goal

Redesign Settings so the instance owner can clearly add subscription/provider-account access or an API key, understand credential ownership, choose a model deliberately, and recover safely from authentication failures without exposing secrets or replacing Pi's credential storage.

## Context

The existing Settings page lists every provider and authentication method in one long section.

Pi `ModelRuntime` remains the source of truth for provider metadata, authentication, available models, and credential persistence.

The current uncommitted model-availability, interaction-replay, error-mapping, and model-rollback fixes are part of the starting implementation and must be preserved.

## Architecture

- Keep Settings as one shallow page with a model summary, configured access list, preferences, tools, and account actions.
- Add focused Radix dialogs for adding provider access, choosing a model, and confirming credential removal.
- Extend `/api/models` with safe authentication-method, credential-source, disconnectability, and supported-thinking metadata derived from Pi.
- Route API-key and OAuth authentication through Pi `ModelRuntime`; never return or log credential values.
- Serialize provider authentication attempts and make cancellation explicit.
- Refresh server state after every completed, cancelled, or failed authentication attempt.

## Non-Goals

- Do not add a browser editor for `auth.json` or `models.json`.
- Do not add custom-provider creation or database schema changes.
- Do not switch models automatically after adding access.
- Do not remove or overwrite unknown Pi configuration fields.

## Plan

- [x] Preserve the existing working tree on `feat/model-access-redesign` and record the approved scope in this plan; verified by `git status --short --branch` and this file.
- [x] Inspect Pi provider/authentication APIs and current repository contracts to define safe response metadata and cancellation semantics; verified in `node_modules/@earendil-works/pi-ai/dist/auth/types.d.ts`, `models.d.ts`, and `@earendil-works/pi-coding-agent/dist/core/model-runtime.d.ts`: OAuth exposes `isSubscription`, credential listing is non-secret, status identifies stored/environment/config sources, provider login owns persistence, and `getSupportedThinkingLevels` exposes model-safe levels.
- [x] Add failing server tests for credential source/disconnectability, subscription metadata, supported thinking levels, direct API-key submission, authentication serialization/cancellation, safe responses, and model rollback; verified red with `npm test -- --run tests/server/agent.test.ts tests/server/api.test.ts` (6 intended failures: missing metadata/service methods, key forwarding, serialization, and cancellation route).
- [x] Implement the smallest Pi-service and Hono API changes that satisfy the server tests without directly editing Pi credential files; verified by 20 focused server tests and `npm run build:server`.
- [x] Add failing Web tests for loading, empty, API-key success, error/retry, method filtering/search, model preview/confirmation/cancellation, credential-removal confirmation, managed credentials, and accessible secret input; verified red with `npm test -- --run tests/web/app.test.tsx` (6 redesign failures plus expected legacy-render errors from the new metadata shape).
- [x] Implement the approved Settings hierarchy and Radix dialogs using existing visual conventions, with localized copy and explicit state transitions; verified by 10 focused Web tests and a successful production Web build.
- [x] Update CSS and documentation for responsive behavior, credential-source semantics, subscription/API-key flows, OAuth recovery, and model application; verified by the 760 px/390 px-safe CSS rules, accessibility-focused component tests, README workflow, `npm run check`, and successful Web build.
- [x] Run repository checks, focused regression tests, builds, Docker Compose deployment, and health checks; verified by `npm run ci` (13 files, 111 passed, 5 skipped, server/Web builds), `just smoke` (SQLite ready), `just postgres-smoke` (PostgreSQL ready), `just up`, healthy production container, local/public `/health/ready` responses, public HTTP 200, and unauthenticated `/api/models` HTTP 401.
- [x] Review the complete diff for security, secret handling, lifecycle cleanup, cancellation, compatibility, accessibility, regressions, and unnecessary complexity; review found and fixed current-model header leakage, generic cancellation misclassification, provider-login shutdown cleanup, missing partial/pending recovery states, external-credential removal protection, multi-step API-key prompt fallback, and non-actionable OAuth recovery; affected tests and builds pass.
- [x] Audit every approved acceptance criterion and preserve the prerequisite working-tree fixes; verified by all completion checklist evidence, manual diff review, and an explicit remaining limitation that real third-party provider credentials were not exercised.

## Risks

- OAuth loopback callbacks can be unreachable from a container, so the UI must retain manual URL, device-code, and prompt recovery paths.
- Some providers use multi-step API-key authentication, so the flow must continue to support Pi prompts rather than assume every provider needs only one secret.
- Credentials supplied through environment variables or `models.json` are externally managed and must not be presented as removable from the Web UI.
- Authentication cancellation must release all pending interactions and the serialization lock without leaving a misleading configured state.
- A model change affects both chat and heartbeat sessions and must restore the previous valid model if either update fails.

## Rollback / Recovery

- No database migration is planned.
- Existing `auth.json`, `models.json`, environment credentials, and unknown fields remain owned by Pi and are not rewritten by custom code.
- The UI refreshes authoritative `/api/models` state after every flow, including partial failure.
- Reverting the application changes restores the previous interface without a data rollback.

## Completion Checklist

- [x] Subscription/provider-account and API-key access are separate, searchable workflows verified by `tests/web/app.test.tsx`.
- [x] Credential values never appear in API responses, events, logs, or rendered confirmation text, verified by API secret-redaction tests, password-field tests, and direct diff review.
- [x] Loading, empty, partial, success, error, disabled, cancellation, pending-flow restore, and OAuth recovery states are verified by `tests/web/app.test.tsx` and server cancellation tests.
- [x] Model selection requires explicit confirmation, cancellation has no side effect, and chat/heartbeat updates roll back on failure, verified by Web model-picker tests and `tests/server/agent.test.ts`.
- [x] Externally managed credentials show their source without a misleading disconnect action, while stored credentials require removal confirmation, verified by API and Web tests.
- [x] Keyboard labels, Radix focus behavior, non-color status text, password-field semantics, and narrow-layout stacking rules are verified by Web tests, Biome accessibility rules, and the 760 px CSS breakpoint supporting a 390 px viewport.
- [x] Existing Pi credential/configuration files and unknown fields are preserved with no database migration, verified by routing all persistence through `ModelRuntime.login/logout` and adding no storage/schema changes.
- [x] `npm run ci` passes with 111 tests passed and 5 skipped; Docker SQLite/PostgreSQL smoke checks pass; the reviewed image is deployed with a healthy container and local/public readiness responses.
- [x] README documents the completed workflow and its recovery constraints in `README.md` under Models and providers.
- [x] The final diff contains only intended model-access work and preserved prerequisite fixes, verified by `git diff --check`, `git status --short`, secret-pattern review, static-import review, and manual diff review.
