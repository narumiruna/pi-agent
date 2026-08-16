# Trusted Skill Management and Activation Plan

Status: Completed on 2026-08-16.

## Goal

Implement the Phase 4 milestone “支援受信任 skill CRUD、activation settings 與 native reload” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-4skills).

Let the Web create standards-shaped user skills, edit or delete canonical user and trusted-project skills, and control Pi’s native `enableSkillCommands` setting while preserving native discovery, trust, command expansion, system-prompt generation, and reload behavior.

## Context

The merged Skills page reads only Pi’s active `ResourceLoader.getSkills()` snapshot and safely views skill files.

Pi 0.84.1 treats `~/.pi/agent/skills/` and trusted `.pi/skills/` as canonical locations, supports directory `SKILL.md` and direct root Markdown entries, and includes loaded non-disabled skills in the system prompt.

Pi’s documented `enableSkillCommands` setting defaults to `true`; its interactive UI uses that setting to register `/skill:name` autocomplete entries, while skill content expansion and native resource loading stay owned by `AgentSession`.

`SettingsManager.setEnableSkillCommands()` writes the global native setting, and `AgentSession.reload()` reloads settings, skills, the system prompt, extensions, and command state.

The Roadmap reserves full regression, E2E, accessibility, security, and release-readiness review for Phase 8, so this implementation milestone runs only directly related unit tests.

## Architecture

Add shared Agent Skills name/description limits, write contracts, effective command/model activation flags, and edit/delete permissions to the existing inventory response.

Create skills only as `<canonical-root>/<name>/SKILL.md` with standards-shaped YAML frontmatter and a minimal instruction skeleton; accept only lowercase Agent Skills names and bounded non-empty descriptions.

Treat only top-level-origin entries physically contained under `~/.pi/agent/skills/` or trusted `.pi/skills/` as Web-managed; package, temporary, settings-added, `.agents`, untrusted-project, symlinked, hard-linked, or unsafe entries remain read-only.

Use a dedicated skill manager with pinned roots, containment checks, no-follow identity checks, atomic create/write, conflict detection, and quarantine-based file or directory deletion.

Run every skill mutation through the existing `PiService.mutateResources()` maintenance lease so trust refreshes before mutation and both native sessions reload afterward.

Expose Pi’s effective `enableSkillCommands` value, persist changes through `SettingsManager`, flush before reload, filter Web `/skill:name` autocomplete consistently, and publish the existing resource-reload event.

Extend the read-only Skills UI with a trusted create form, editable entry document, guarded delete flow, effective model/command state, and the global native command toggle.

## Non-Goals

- Do not manage package, temporary, settings-added, `.agents`, symlinked, hard-linked, or untrusted-project skills.
- Do not edit references, scripts, binary assets, package filters, arbitrary settings skill paths, or project settings arrays.
- Do not execute skill scripts or add a browser-side skill runtime.
- Do not change Pi’s skill discovery order, collision winner, frontmatter interpretation, system-prompt formatter, or command expansion implementation.
- Do not add the package guardrails, full compatibility diagnostics, or stronger trusted-code warning reserved for the next Phase 4 milestone.
- Do not run Phase 8 regression, E2E, Docker, cross-database, accessibility, security-scan, or release-readiness checks.

## Risks

- Recursive skill deletion could remove siblings or escape through a replaced directory; delete only the native entry’s canonical skill directory after atomic quarantine, and delete a root-level direct entry as a file only.
- External filesystem changes can race writes; pin roots, reject symlinks/hard links, compare file identities, and use existing atomic persistence primitives.
- A create can become a hidden collision; reject any active native skill with the same name and never overwrite an existing entry or non-empty directory.
- Invalid YAML edits can make a skill disappear after native reload; preserve the user’s explicit text but surface Pi’s refreshed diagnostics and clear stale IDs safely.
- Project trust can change between display and mutation; re-evaluate trust and canonical ownership inside the maintenance lease.
- Settings writes can reload stale values if not durable; flush `SettingsManager` before native session reload and return the effective value after reload.
- Web autocomplete could disagree with Pi’s setting; filter skill commands from the existing command projection using the same native effective setting.

## Plan

- [x] Inspect the merged Skills inventory/viewer, Pi 0.84.1 skills and settings docs, installed `SettingsManager`, `AgentSession`, interactive/RPC command behavior, reload coordinator, and atomic persistence helpers.
- [x] Create fresh branch `narumiruna/feat/skill-management` from merged `main` and add this dedicated plan before implementation.
- [x] Add shared skill name/description policies, write/settings contracts, permissions, and effective activation fields.
- [x] Implement canonical ownership checks and standards-shaped user/project skill creation.
- [x] Implement identity-pinned entry updates plus quarantine-based direct-file or skill-directory deletion.
- [x] Route create/update/delete through native maintenance, trust refresh, and two-session reload without patching loader arrays.
- [x] Expose and persist native `enableSkillCommands`, and align Web command projection with its effective value.
- [x] Add mutation and settings API endpoints using only opaque skill IDs, trusted scopes, and bounded bodies.
- [x] Extend Skills UI with create, entry edit/save, delete confirmation, command toggle, activation state, pending/error/success handling, and read-only fallbacks.
- [x] Document canonical ownership, native reload, command setting, and remaining read-only boundaries.
- [x] Add focused server/API/Web unit coverage for skeleton creation, name/description bounds, user/project trust, collisions, permissions, stale IDs, symlink/hard-link/race rejection, recursive delete isolation, reload, settings persistence, command filtering, and UI flows.
- [x] Run directly related unit suites, formatting, and TypeScript/Web build checks; record exact results.
- [x] Audit scope against this plan and Roadmap milestone, then update evidence and completion checks.
- [x] Commit, push, and merge dedicated signed implementation pull request [#55](https://github.com/narumiruna/pi-agent/pull/55), which linked this plan and Roadmap milestone, as `437f028` after CI passed with no blocking feedback.
- [x] After merge, check the matching Roadmap milestone and archive this plan through administrative documentation pull request [#56](https://github.com/narumiruna/pi-agent/pull/56).

## Completion Checklist

- [x] Valid user skills are created in `~/.pi/agent/skills/<name>/SKILL.md` with an Agent Skills-compatible skeleton.
- [x] Canonical user and trusted-project entries are editable and deletable; all other origins and untrusted project entries fail closed.
- [x] Direct root Markdown deletion cannot remove sibling skills, while a managed directory skill deletion removes only its own quarantined directory.
- [x] Writes reject collisions, existing content, oversized bodies, stale IDs, symlinks, hard links, and replaced targets without overwriting unrelated files.
- [x] Every successful mutation reloads both native sessions and refreshes system-prompt plus `/skill:name` state through Pi.
- [x] Effective model-invocation and command activation states appear in inventory.
- [x] `enableSkillCommands` persists through native settings and Web autocomplete follows it.
- [x] Browser mutations use only opaque IDs, canonical scopes, bounded text, and explicit delete confirmation.
- [x] Directly related server, API, Web, and command/settings unit tests pass.
- [x] Dedicated implementation pull request [#55](https://github.com/narumiruna/pi-agent/pull/55) merged as `437f028` with CI passing and no blocking feedback.
- [x] The Roadmap milestone is checked and this plan is archived only after the implementation merge.

## Verification

- `npx vitest run tests/server/skill-manager.test.ts tests/server/skill-viewer.test.ts tests/server/api.test.ts tests/server/agent.test.ts tests/server/resources.test.ts tests/server/project-trust.test.ts tests/web/skills.test.tsx` — 197 tests passed.
- `npm run check` — passed.
- `npm run check:e2e` — TypeScript E2E contracts passed; browser E2E execution remains deferred to Phase 8.
- `npm run build:server` — passed.
- `npm run build:web` — passed with the existing Monaco chunk-size warning.
- Scope audit: no package/filter management, arbitrary skill paths, helper-script execution, parallel skill catalog, or parallel activation store was added.
- GitHub CI passed on final implementation head `a9304ab`; implementation pull request [#55](https://github.com/narumiruna/pi-agent/pull/55) merged as `437f028` with no submitted review findings or blocking feedback.
