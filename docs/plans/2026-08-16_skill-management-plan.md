# Trusted Skill Management and Activation Plan

Status: In progress.

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
- [ ] Add shared skill name/description policies, write/settings contracts, permissions, and effective activation fields.
- [ ] Implement canonical ownership checks and standards-shaped user/project skill creation.
- [ ] Implement identity-pinned entry updates plus quarantine-based direct-file or skill-directory deletion.
- [ ] Route create/update/delete through native maintenance, trust refresh, and two-session reload without patching loader arrays.
- [ ] Expose and persist native `enableSkillCommands`, and align Web command projection with its effective value.
- [ ] Add mutation and settings API endpoints using only opaque skill IDs, trusted scopes, and bounded bodies.
- [ ] Extend Skills UI with create, entry edit/save, delete confirmation, command toggle, activation state, pending/error/success handling, and read-only fallbacks.
- [ ] Document canonical ownership, native reload, command setting, and remaining read-only boundaries.
- [ ] Add focused server/API/Web unit coverage for skeleton creation, name/description bounds, user/project trust, collisions, permissions, stale IDs, symlink/hard-link/race rejection, recursive delete isolation, reload, settings persistence, command filtering, and UI flows.
- [ ] Run directly related unit suites, formatting, and TypeScript/Web build checks; record exact results.
- [ ] Audit scope against this plan and Roadmap milestone, then update evidence and completion checks.
- [ ] Commit, push, and merge one dedicated signed implementation pull request linking this plan and Roadmap milestone after required checks and blocking feedback are resolved.
- [ ] After merge, check the matching Roadmap milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [ ] Valid user skills are created in `~/.pi/agent/skills/<name>/SKILL.md` with an Agent Skills-compatible skeleton.
- [ ] Canonical user and trusted-project entries are editable and deletable; all other origins and untrusted project entries fail closed.
- [ ] Direct root Markdown deletion cannot remove sibling skills, while a managed directory skill deletion removes only its own quarantined directory.
- [ ] Writes reject collisions, existing content, oversized bodies, stale IDs, symlinks, hard links, and replaced targets without overwriting unrelated files.
- [ ] Every successful mutation reloads both native sessions and refreshes system-prompt plus `/skill:name` state through Pi.
- [ ] Effective model-invocation and command activation states appear in inventory.
- [ ] `enableSkillCommands` persists through native settings and Web autocomplete follows it.
- [ ] Browser mutations use only opaque IDs, canonical scopes, bounded text, and explicit delete confirmation.
- [ ] Directly related server, API, Web, and command/settings unit tests pass.
- [ ] Dedicated implementation PR is merged with blocking feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.

## Verification

- Pending implementation.
