# Skills Inventory and Viewer Plan

Status: In progress.

## Goal

Implement the Phase 4 milestone “建立 Skills inventory 與唯讀 viewer” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-4skills).

Add a canonical `/skills` destination that lists Pi’s discovered skills with provenance and native validation warnings, then safely views each skill entry point and bundled references, scripts, or assets without exposing host paths or binary content.

## Context

Pi 0.84.1 discovers global, trusted-project, package, settings-added, and temporary skills through `ResourceLoader.getSkills()` and returns first-winner `Skill` objects plus `ResourceDiagnostic` warnings.

Each native `Skill` supplies its name, description, actual entry file, base directory, source metadata, and model-invocation state.

Pi recursively discovers directories containing `SKILL.md`, also supports direct root Markdown skills in selected locations, warns for most Agent Skills validation failures, omits skills with missing descriptions, and keeps the first name collision winner.

The shared route contract reserves `/skills`, but current routing and navigation intentionally omit it.

The Roadmap reserves full regression, E2E, accessibility, security, and release-readiness review for Phase 8, so this implementation milestone runs only directly related unit tests.

## Architecture

Keep `ResourceLoader.getSkills()` as the sole catalog and expose its current skills plus diagnostics through the existing native resource runtime adapter.

Project each skill to an opaque ID, sanitized metadata, scope/origin provenance, source label, logical entry path, and bounded file metadata.

For directory skills, enumerate regular non-symlink files beneath the native skill `baseDir`; for direct Markdown skills, expose only the native entry file so a shared root cannot reveal sibling skills.

Use a separate read-only skill viewer module with lexical containment, real-directory checks, no-follow file opens, file-identity checks, file/depth/size bounds, UTF-8 validation, and path revalidation on every read.

Classify UTF-8 text as viewable and return only size/type metadata for binary, oversized, symlinked, hard-linked, or otherwise unavailable assets.

Add `/api/skill-inventory` and an opaque-ID plus relative-path file endpoint, then render a localized Skills page with inventory, provenance, warnings, file metadata, and a plain-text viewer.

## Non-Goals

- Do not scan for a second skill catalog, load omitted skills as active resources, or modify Pi’s discovery and collision order.
- Do not create, edit, delete, enable, disable, install, update, or reload skills in this milestone.
- Do not add `/skill:name` activation settings or `enableSkillCommands` controls.
- Do not add the package-management guardrails, compatibility diagnostics, or stronger trusted-code warning reserved for later Phase 4 milestones.
- Do not execute scripts, render skill HTML, preview binary assets, follow symlinks, or expose absolute paths.
- Do not run Phase 8 regression, E2E, Docker, cross-database, accessibility, security-scan, or release-readiness checks.

## Risks

- File browsing could escape a skill root through traversal, symlinks, hard links, or races; accept only server-enumerated relative paths and revalidate containment and identity at open/read time.
- A direct root Markdown skill shares a directory with unrelated resources; expose only its entry file unless the native entry is `SKILL.md`.
- Package and settings paths can contain credentials or installation details; derive logical labels from source metadata and bounded basenames only.
- Binary or oversized assets can corrupt the UI or consume memory; classify with bounded reads and never return their content.
- Native diagnostics can reference omitted files; show bounded path-safe global warnings without inventing active skill records.
- Project resources can change after trust or reload; build inventory and file reads inside the existing maintenance snapshot and reject stale opaque IDs.

## Plan

- [x] Inspect the merged route/navigation/resource architecture, Pi 0.84.1 skills/package/security docs, installed skill/resource-loader/source-info types and implementation, and existing trust/command tests.
- [x] Create fresh branch `narumiruna/feat/skills-inventory` from merged `main` and add this dedicated plan before implementation.
- [x] Add shared skill inventory, diagnostic, file-metadata, and file-document contracts with explicit bounds.
- [x] Expose Pi’s native skill snapshot through the existing resource runtime adapter.
- [x] Implement path-safe provenance, entry-path, native-diagnostic, and bounded file-tree projection without parallel discovery.
- [x] Implement opaque-ID and relative-path text reads with binary/oversized metadata-only behavior and race-resistant containment.
- [x] Add snapshot-protected skill inventory and file endpoints.
- [x] Activate `/skills` in canonical routing, desktop/mobile navigation, and localized labels in Roadmap order.
- [x] Add a read-only Skills page for metadata, warnings, bundled-file selection, loading/error states, and plain-text content.
- [x] Document the native inventory/viewer boundary without claiming CRUD, activation, package-management, or later diagnostics scope.
- [x] Add focused server/API/Web/route/navigation unit coverage for provenance, trust, diagnostics, direct-file isolation, nested files, binary/size classification, traversal, symlink/hard-link rejection, and viewer behavior.
- [x] Run directly related unit suites, formatting, and TypeScript/Web build checks; record exact results.
- [x] Audit scope against this plan and Roadmap milestone, then update evidence and completion checks.
- [ ] Commit, push, and merge one dedicated signed implementation pull request linking this plan and Roadmap milestone after required checks and blocking feedback are resolved.
- [ ] After merge, check the matching Roadmap milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] `/skills` is canonical and appears after Prompts in desktop and mobile navigation.
- [x] Inventory uses only Pi’s active `getSkills()` snapshot and shows global, trusted-project, package, settings-added, and temporary provenance without host paths.
- [x] Native validation warnings are bounded, path-safe, and associated with active skills when possible.
- [x] The viewer exposes the actual entry file plus safe directory-skill references, scripts, and assets; direct root skills expose no siblings.
- [x] Text files render as plain text, while binary, oversized, symlinked, hard-linked, and unavailable files expose metadata only.
- [x] Browser requests contain only opaque skill IDs and validated relative paths.
- [x] Trust/reload changes replace stale inventory and stale IDs fail closed.
- [x] Directly related server, API, Web, route, and navigation unit tests pass.
- [ ] Dedicated implementation PR is merged with blocking feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.

## Verification

- `npm test -- tests/server/skill-viewer.test.ts tests/server/api-metadata.test.ts tests/server/api.test.ts tests/server/agent.test.ts tests/server/resources.test.ts tests/server/project-trust.test.ts tests/web/skills.test.tsx tests/web/navigation.test.ts tests/web/navigation-component.test.tsx tests/web/routes.test.ts tests/web/app.test.tsx` passed all 253 focused tests across 11 files.
- `npm run check` passed Biome formatting and lint checks across 149 files.
- `npm run check:e2e` passed TypeScript checking for the updated canonical route contract without running deferred browser scenarios.
- `npm run build:server && npm run build:web` passed; Vite reported only the existing chunk-size advisory.
- A real Pi `DefaultResourceLoader` test proves missing-description files remain outside the active catalog while their native warnings remain visible.
- Projection tests cover global `.pi`, global `.agents`, trusted project, package, settings-added, and temporary source/provenance labels without absolute paths.
- File-viewer tests cover `SKILL.md`, references, scripts, binary assets, the 500 KB content bound, a 500-entry traversal bound, direct-file sibling isolation, traversal rejection, stale IDs, symlinks, and hard links.
- API tests pin maintenance-snapshot inventory/file reads and reject browser-supplied extra absolute-path fields.
- Web tests cover provenance, trust messaging, warning association, metadata-only assets, UTF-8 text viewing, errors, and stale inventory replacement.
- Diff audit confirmed that Pi’s `getSkills()` winners and diagnostics remain authoritative; no CRUD, activation, package mutation, script execution, or duplicate skill discovery was added.
