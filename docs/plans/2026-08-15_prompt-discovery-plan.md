# Native Prompt Discovery and Permissions Plan

Status: In progress.

## Goal

Implement the Phase 3 milestone “接上 Pi native prompt discovery、provenance、permission 與 reload flow” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-3prompts).

Replace the Prompts page’s global-directory-only template list with Pi 0.84.1’s authoritative discovered prompt-template inventory, while preserving safe metadata, native scope/origin, project trust, read-only package/temporary resources, native file locations, reload, and slash-command behavior.

## Context

The first Prompts milestone moved global `SYSTEM.md`, `APPEND_SYSTEM.md`, and user `prompts/*.md` CRUD out of Library without changing storage.

`ResourceService.listTemplates()` still scans only the global user directory and assigns fixed user/top-level provenance, so it cannot represent trusted project, package, settings-added, or temporary templates loaded by Pi.

Pi’s `ResourceLoader.getPrompts()` already returns the deduplicated active templates with parsed description, argument hint, content, file path, and native `SourceInfo` (`scope`, `origin`, `source`, and optional `baseDir`).

Pi discovers global and trusted project prompt directories, package resources, settings paths, and CLI temporary paths through its package/settings/resource loader and uses `AgentSession.promptTemplates` for `/command` expansion.

Existing resource mutations already persist before invoking `PiService.reload()`, which performs the native session reload lifecycle and refreshes `/api/commands`.

## Architecture

Expose one safe native prompt-resource projection sourced only from the active Pi resource loader.

Each item carries an opaque server-derived ID, bounded name/description/argument hint/content, native scope/origin, a safe logical path, a safe source label, and an explicit editable flag.

Map canonical user templates to `~/.pi/agent/prompts/<name>.md` and canonical trusted project templates to `.pi/prompts/<name>.md` without returning host/container absolute paths.

Package paths use a sanitized package label plus package-relative path; settings-added or temporary paths use a neutral logical prefix and basename.

Direct non-symlink user files in the canonical global prompt directory are editable through opaque IDs.

Direct non-symlink project files in the canonical workspace prompt directory are editable only while Pi’s effective project trust is true.

Package-origin, temporary, collision losers absent from Pi’s active deduplicated inventory, and unsafe files remain read-only.

Resolve every create/edit/delete under the coordinator’s maintenance lease, refresh effective trust and native discovery before mutation, resolve opaque IDs against the current loader snapshot, never accept a browser path, and reload both native sessions before releasing the lease.

Create user or trusted-project templates only in Pi’s canonical directories, reject existing files and higher-precedence native winners, and retain legacy `/api/templates` compatibility under the same maintenance and precedence rules while Prompts uses the new native inventory API.

Render source, logical path, provenance, argument hint, and editability in Prompts, provide a focusable read-only viewer for non-editable resources, and offer project create scope only when effective runtime trust is enabled; Settings permits an acknowledged proactive trust decision before the first project resource.

Project Chat commands from Pi’s resolved extension invocation list and include native prompt argument hints plus safe source/provenance labels.

## Non-Goals

- Do not add custom prompt validation diagnostics, collision UI, frontmatter diagnostics, or size warnings reserved for the next milestone.
- Do not manage package filters, settings `prompts` arrays, package installation, or temporary CLI resources from Prompts.
- Do not make package, temporary, non-canonical settings-added, nested, symlinked, or untrusted project resources writable.
- Do not expose native absolute paths, raw package sources, installation roots, `baseDir`, or filesystem-derived browser IDs.
- Do not create a prompt database, duplicate resource registry, browser-side discovery, or custom reload/command cache.
- Do not change the prior milestone’s explicit global `SYSTEM.md` and `APPEND_SYSTEM.md` editors; this milestone’s native inventory concerns Pi prompt templates.

## Risks

- Native source paths and package sources can contain host paths or credentials; project only opaque IDs and bounded logical labels.
- Editing parsed template body instead of raw editable Markdown can silently erase frontmatter; read canonical editable files verbatim while using Pi’s parsed content for read-only resources.
- An opaque ID can become stale after reload, package update, trust change, or external deletion; resolve it against the current native snapshot and fail closed.
- Project trust can change independently from a stale browser; enforce effective trust again on every project create/edit/delete.
- A symlink under a canonical prompt directory can escape the managed boundary; reject it for writes and mark it read-only.
- Duplicate prompt names follow Pi’s first-winner loader semantics; never rescan into a parallel list that resurrects collision losers.
- Reload failure can leave a persisted file ahead of the active runtime; preserve the existing visible error contract and do not report command refresh success.
- Source/path metadata and action rows can overflow at 390px; wrap bounded text and verify keyboard/read-only behavior and accessibility.

## Plan

- [x] Read Pi 0.84.1 prompt-template, package, settings, project-trust, and security documentation plus installed exports, declarations, resource-loader/prompt implementations, source metadata, deduplication, and expansion behavior.
- [x] Inventory current Prompts page, legacy ResourceService/API, native command projection/reload, safe metadata helpers, and server/Web/E2E coverage.
- [x] Create fresh branch `narumiruna/feat/prompt-discovery` from merged `main` and add this dedicated plan before implementation.
- [x] Add shared safe prompt-resource contracts and server projection helpers for opaque IDs, logical paths, safe sources, native provenance, content bounds, and editability.
- [x] Expose PiService’s read-only native prompt snapshot without mutating loader collections.
- [x] Add native inventory/list, scoped create, opaque-ID edit, and opaque-ID delete service/API operations with project-trust and symlink/boundary enforcement.
- [x] Preserve legacy template endpoints while migrating Prompts to the native inventory endpoint.
- [x] Add Prompts source/path/provenance/argument-hint/read-only UI plus user/trusted-project create scope and pending/error behavior.
- [x] Add server regressions for global/project/package/settings/temporary projection, stale IDs, trust changes, symlinks, path/source non-disclosure, raw frontmatter preservation, native reload, and command refresh.
- [x] Add Web regressions for read-only package/temporary viewing, project scope permissions, native metadata, edit/delete action visibility, and stale/failure handling.
- [x] Add desktop and 390px E2E for trusted project discovery/edit, user creation, package/temporary read-only behavior where practical, `/command` autocomplete refresh, keyboard focus, overflow, and accessibility.
- [x] Update README with native discovery sources, safe logical paths, editability rules, project trust, and reload/autocomplete behavior.
- [x] Run focused tests, `npm run ci`, full E2E, PostgreSQL storage verification, and production Docker build; record exact results.
- [x] Audit native source fidelity, precedence/deduplication, trust races, symlink/containment, raw frontmatter, path/source leakage, stale IDs, reload ordering, command expansion, accessibility, responsive layout, and unrelated changes.
- [ ] Commit, push, open one dedicated signed pull request linking this plan and Roadmap milestone, resolve all checks/review feedback with regressions, and merge.
- [ ] After merge, check the matching Roadmap milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] Prompts lists the active templates returned by Pi native discovery across user, trusted project, package, settings-added, and temporary sources.
- [x] Scope, origin, safe source, logical path, description, argument hint, and editability remain accurate without private path/source disclosure.
- [x] Package, temporary, non-canonical settings-added, nested, symlinked, and untrusted project resources are read-only.
- [x] Creates and mutations use only Pi’s canonical user or trusted-project prompt directories, and browser requests carry opaque IDs rather than paths.
- [x] Editable raw Markdown preserves frontmatter and read-only content remains viewable.
- [x] Mutations invoke native reload and refreshed `/api/commands` plus Chat autocomplete reflect create/edit/delete results.
- [x] Legacy template APIs remain compatible and no parallel prompt state exists.
- [x] Desktop/mobile permission, command, keyboard, responsive, and accessibility regressions pass.
- [x] Focused tests, CI, full E2E, PostgreSQL verification, and Docker build pass.
- [ ] The dedicated implementation PR is merged with all feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.

## Progress updates

### 2026-08-15 — Native prompt discovery implementation

- Status: Implemented and locally verified; the implementation PR and post-merge administration remain.
- Evidence: `npm run ci` passed 429 tests with 6 skips across 28 files and completed both production builds; `npx playwright test` passed all 30 desktop/mobile tests; PostgreSQL storage verification passed all 14 tests; `docker build -t pi-agent:local .` produced image `sha256:7905abe70e9cc5007dab22c68e19d4149c532a08506116c958b5125200c9828a`.
- Review: The complete diff and prompt resource lifecycle were audited locally for native fidelity, precedence, trust races, filesystem identity, path disclosure, failure recovery, accessibility, and scope; no external `pi -p` review is part of this delivery.
- Pull request: [#47](https://github.com/narumiruna/pi-agent/pull/47).
- Remaining: Required PR checks/review, merge, then Roadmap completion and plan archival in a follow-up documentation PR.

### 2026-08-16 — Linux inode-reuse regression

- GitHub CI exposed that an immediate same-path replacement can reuse the original inode on Linux, so device and inode alone were not a sufficient mutation identity.
- Expected prompt identities now also bind creation time and size, while secure reads compare change time and size before and after reading.
- Evidence: the focused resource suite passed five consecutive runs; PostgreSQL-enabled `npm run ci` passed all 435 tests; focused desktop/mobile prompt E2E passed all 5 tests.

### 2026-08-16 — Pull request review ledger

- Actionable P1, [keep trust policy active for a clean workspace](https://github.com/narumiruna/pi-agent/pull/47#discussion_r3790774448): addressed by retaining the native trust resolver and re-evaluating extension trust immediately after every resource mutation, before the new snapshot reloads; an integration regression proves a global denial unloads the first project prompt created under proactive default trust.
- Actionable P2, [enforce prompt filename byte limits](https://github.com/narumiruna/pi-agent/pull/47#discussion_r3790774449): addressed by applying the 255-byte UTF-8 component limit, including `.md`, in shared browser/server validation and at the API boundary; CJK boundary and rejection regressions cover the limit.
- Actionable CI failure, Linux inode reuse: addressed by binding prompt mutations to creation time and size in addition to device and inode, with a focused identity regression.
- Evidence: PostgreSQL-enabled `npm run ci` passed all 439 tests, including shared API and Web UTF-8 boundary coverage; full Playwright passed all 30 tests; `docker build -t pi-agent:local .` passed with image `sha256:2d540c0c8a74883e60828b25f1cc24fee29f67c5a18af88d90c9123aef8d0cdc`; `git diff --check` passed.
