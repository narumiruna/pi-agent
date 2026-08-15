# Project Resource Trust Plan

Status: In progress.

## Goal

Implement the Phase 0 milestone “Project-local skill 與 extension 只有在 Pi project trust 生效後才能載入或修改” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-0共用基礎與安全邊界).

Use Pi's native project-trust store and resource loader so project skills and executable extensions remain unavailable until the owner explicitly trusts the configured workspace or Pi's global non-interactive policy already does so.

## Context

Pi's installed `SettingsManager`, `ProjectTrustStore`, `hasTrustRequiringProjectResources()`, and `DefaultResourceLoader` already implement the canonical trust boundary.

The Web currently constructs `SettingsManager` with `projectTrusted: false`, which safely excludes project resources but also ignores saved native trust decisions and offers no explicit owner flow to enable them.

No current Web endpoint edits project skills or extensions, so this milestone must establish and verify the shared trust gate without prematurely adding their management pages.

## Architecture

Resolve initial trust before resource discovery from Pi's canonical trust-requiring-resource detector, nearest saved native decision, and global `defaultProjectTrust`; `ask` remains untrusted because the server startup has no synchronous trust UI.

Keep one shared `SettingsManager` trust flag for chat and heartbeat resource loaders.

Expose a path-free trust status and an authenticated risk-acknowledged mutation in Settings.

Apply a changed decision only while the agent is idle, reload both native sessions so project resources load or unload through Pi, then persist the decision in Pi's native `trust.json` store.

Do not add project resource writes; future project skill and extension mutations must reuse the same trusted status.

## Non-Goals

- Do not treat project trust as a sandbox or permission system for model tools.
- Do not load project resources merely because the Web owner authenticated.
- Do not infer trust from paths, Git state, package provenance, or browser state.
- Do not add project skill or extension CRUD before their dedicated Roadmap phases.
- Do not replace Pi's trust store, settings manager, resource loader, or reload lifecycle.

## Risks

Trusting a project can execute extensions and install project packages with the application's full permissions.

Persisting before a failed reload can leave saved trust inconsistent with the active runtime, while persisting after reload needs rollback if storage fails.

Disabling trust during an active run can invalidate tools or extensions in use.

Mitigate with mandatory acknowledgement, idle coordination, native reload, rollback tests, explicit warnings, saved/default decision matrices, and loaded-resource regressions.

## Plan

- [x] Read Pi's complete settings and security documentation and inspect installed `SettingsManager`, `ProjectTrustStore`, project-trust resolution, resource-loader reload, and service declarations.
- [x] Inventory current trust behavior and resource mutations; startup is always untrusted, native saved/default decisions are ignored, and no project skill/extension write endpoint exists.
- [x] Create fresh branch `narumiruna/feat/project-resource-trust` from current `main` before implementation.
- [x] Add a small native trust policy module and shared path-free status contract; verify no-resource, saved allow/deny, inherited decision, and global always/ask/never behavior.
- [x] Initialize the shared Pi settings manager with the resolved trust decision before any chat or heartbeat resource discovery.
- [x] Add authenticated status and risk-acknowledged trust mutation APIs that wait for idle, hold a maintenance lease, reload both native sessions, persist through `ProjectTrustStore`, and roll back failures.
- [x] Add a Settings trust surface with executable-code warning, explicit acknowledgement, current status, enable, and disable actions.
- [x] Add native loader, service, API, Web, and E2E regressions proving project skills/extensions are absent before trust, present after trust, removed after disable, and never writable through a bypass.
- [x] Update security documentation to describe startup resolution, acknowledgement, persistence, reload, and the non-sandbox boundary.
- [x] Run focused server/Web tests, `npm run ci`, local E2E, and the production Docker build; record exact results.
- [x] Review the complete diff for fail-open behavior, pre-trust execution, active-run races, persistence ordering, rollback, path disclosure, bypass writes, native behavior, and unrelated changes.
- [x] Commit, push, and open dedicated pull request [#24](https://github.com/narumiruna/pi-agent/pull/24) with a signed implementation commit linking this plan and Roadmap milestone.
- [x] Read all pull-request checks and feedback; CI passed and no actionable review feedback remained.
- [ ] Merge the clean pull request.
- [ ] After merge, check the matching Roadmap milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] Project trust starts from Pi's saved decision or non-interactive global default and fails closed for `ask` or errors.
- [x] Project skills and extensions do not load while trust is false.
- [x] Explicit trust requires authenticated owner access and risk acknowledgement.
- [x] Trust changes wait for an idle agent, hold a maintenance lease, and use native reload for chat and heartbeat sessions.
- [x] Successful decisions persist only in Pi's native trust store.
- [x] Failed reload or persistence restores the previous runtime trust state.
- [x] Disabling trust unloads project resources.
- [x] No project skill or extension mutation bypass exists.
- [x] The Web exposes no workspace path or trust-store internals.
- [x] Documentation states that trust enables code/input loading but is not a sandbox.
- [x] Focused tests, `npm run ci`, local E2E, and the Docker production build pass.
- [ ] The dedicated pull request is merged with all feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.

## Verification

- `npm test -- tests/server/project-trust.test.ts tests/server/agent.test.ts tests/server/api.test.ts tests/server/http-auth.test.ts tests/server/workspace.test.ts tests/web/app.test.tsx`: 155 tests passed.
- `npm run ci`: 23 files passed, 289 tests passed, 5 PostgreSQL-dependent tests skipped, and both builds passed.
- `npx playwright test`: all 18 setup, desktop, accessibility, and mobile tests passed.
- `docker build -t pi-agent:local .`: production image built successfully as `sha256:8e42b399454c37fdcfe75145729ef54be96a43289ee90b7a07af063ab4e43bd9`.
