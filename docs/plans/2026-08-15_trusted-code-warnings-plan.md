# Trusted-Code Warnings Plan

Status: In progress.

## Goal

Implement the Phase 0 milestone “Package、skill、extension 與 MCP 必須持續顯示 trusted-code 警告” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-0共用基礎與安全邊界).

Keep a clear, persistent warning at every current Web surface that can install, configure, or enable Pi packages, skills, extensions, or MCP servers.

## Context

The Library package tab already warns that packages can execute arbitrary code and requires acknowledgement before installation.

The Settings project-trust section warns before enabling project packages, skills, and extensions, but the warning becomes less explicit after trust is enabled.

The Library MCP editor currently has no trusted-code warning even though configured servers execute with the application's permissions.

Dedicated Skills and Extensions management pages do not exist yet, so this milestone must establish a reusable warning for those future surfaces without adding premature CRUD.

## Architecture

Add one reusable presentational warning component with shared localized wording that names packages, skills, extensions, and MCP servers as trusted-code boundaries.

Render it persistently in the current package, MCP, and project-trust surfaces, independent of current enabled or trusted state.

Retain the stronger existing acknowledgement gates for package installation and project-trust enablement.

Do not imply that a warning is a sandbox or replace native trust, package, settings, reload, or authentication enforcement.

## Non-Goals

- Do not add Skills or Extensions pages before their dedicated Roadmap phases.
- Do not change package, MCP, project-trust, or resource-loader behavior.
- Do not add a second confirmation or policy model when an existing acknowledgement already applies.
- Do not expose package sources, executable paths, workspace paths, or MCP secrets.

## Risks

A warning hidden behind a transient dialog or disabled state would not remain visible after resources are enabled.

Different wording on each page can drift and understate one trusted-code category.

A warning can create false confidence if it sounds like runtime isolation.

Mitigate with one shared component, persistent placement, explicit full-permission wording, accessibility checks, and Web/E2E regressions across every current surface.

## Plan

- [x] Read the relevant Pi package, skill, extension, security, and MCP integration behavior and inventory current warning surfaces.
- [x] Confirm current gaps: packages and project trust have partial warnings, MCP has none, and no dedicated Skills or Extensions management surface exists.
- [x] Create fresh branch `narumiruna/feat/trusted-code-warnings` from current `main` before implementation.
- [x] Add one reusable localized trusted-code warning component with accessible, non-sandbox wording.
- [x] Render the warning persistently in Library Packages, Library MCP, and Settings project trust while preserving existing acknowledgements.
- [x] Add Web regressions proving every current trusted-code surface retains the warning before and after state changes.
- [x] Add desktop and 390px E2E coverage for warning visibility and accessibility.
- [x] Update README trusted-code boundary documentation.
- [x] Run focused tests, `npm run ci`, full local E2E, and the production Docker build; record exact results.
- [x] Review the complete diff for missing surfaces, transient warning states, misleading sandbox claims, path or secret disclosure, native behavior changes, and unrelated edits.
- [x] Commit, push, and open dedicated pull request [#26](https://github.com/narumiruna/pi-agent/pull/26) with a signed implementation commit linking this plan and Roadmap milestone.
- [ ] Resolve every pull-request check and feedback item with regression coverage, then merge the clean pull request.
- [ ] After merge, check the matching Roadmap milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] One shared warning names packages, skills, extensions, and MCP servers.
- [x] Warning text states that trusted code can execute or direct actions with container permissions.
- [x] Package, MCP, and project-trust surfaces always show the warning.
- [x] Existing package-install and project-trust acknowledgements remain enforced.
- [x] No new resource CRUD or parallel security state exists.
- [x] No path, package source, MCP secret, or runtime internals are exposed.
- [x] Web, E2E, accessibility, CI, and Docker verification pass.
- [ ] The dedicated pull request is merged with all feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.

## Verification

- `npm test -- tests/web/library.test.tsx tests/web/app.test.tsx`: 42 tests passed.
- `npm run ci`: 23 files passed, 294 tests passed, 5 PostgreSQL-dependent tests skipped, and both builds passed.
- The first full E2E run exposed insufficient contrast on the newly scanned legacy MCP save button; adding Radix `highContrast` to Library primary actions fixed it.
- `npx playwright test`: all 18 setup, desktop, accessibility, and mobile tests passed after that fix.
- `docker build -t pi-agent:local .`: production image built successfully as `sha256:a1629e856923a2142f4c25969d6465f89c9b267825e177b836b3c50166a225cf`.
