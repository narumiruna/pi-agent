# Native Resource Reload Plan

Status: In progress.

## Goal

Implement the Phase 0 milestone “資源變更後使用 Pi 原生 reload flow，不直接修改 runtime 內部集合” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-0共用基礎與安全邊界).

Make every current resource mutation persist through Pi-native files, settings, or package APIs and then invoke the public Pi session reload lifecycle.

## Context

`PiService.reload()` already waits for active work, enters the maintenance coordinator, refreshes project trust, and invokes `AgentSession.reload()` for the chat and heartbeat sessions.

Pi's installed `AgentSession.reload()` emits extension shutdown, reloads settings and the native resource loader, rebuilds runtime bindings, and emits reload startup events.

`ResourceService` already writes native resource files and uses Pi's package manager, but it receives an untyped callback that does not make the native lifecycle contract explicit.

The MCP route persists `mcp.json` and calls `PiService.reload()` directly.

Existing E2E coverage redundantly calls `/api/reload` after creating a prompt, so it does not prove that the mutation itself refreshed native command discovery.

No project code currently mutates Pi resource-loader result collections, command maps, prompt arrays, skill lists, or extension lists directly.

## Architecture

Replace the generic reload callback in `ResourceService` with a narrow object interface exposing `reload(): Promise<void>` and inject `PiService` itself.

Continue to persist documents through atomic writes, packages through Pi's `PackageManager`, MCP through its native JSON file, and project trust through Pi's `SettingsManager` and session reload.

Keep `PiService.reload()` as the single public application-level adapter around Pi's native `AgentSession.reload()` lifecycle and active-run coordination.

Add tests for every current resource mutation and verify persistence completes before reload is invoked.

Prove end to end that prompt autocomplete refreshes without a separate manual reload request.

## Non-Goals

- Do not create a parallel resource registry, command cache, reload event protocol, or settings store.
- Do not mutate objects returned by `getPrompts()`, `getSkills()`, `getExtensions()`, or `promptTemplates`.
- Do not add future Prompts, Skills, or Extensions CRUD before their dedicated Roadmap phases.
- Do not redesign rollback behavior when persistence succeeds but native reload reports an error.
- Do not restart the process or bypass active-run coordination.

## Risks

A resource write can appear successful on disk while a failed reload leaves the current session on its previous runtime until a later successful reload.

Calling only `DefaultResourceLoader.reload()` would skip the full session lifecycle and extension rebind behavior.

A redundant E2E `/api/reload` call can mask a missing mutation-triggered reload.

Mitigate by retaining propagated reload errors, calling only `PiService.reload()`, testing operation order and failure behavior, and removing the redundant E2E call.

## Plan

- [x] Inspect current document, package, MCP, project-trust, command-discovery, and reload paths.
- [x] Verify the installed Pi `AgentSession.reload()` API and implementation, including settings/resource reload and extension lifecycle behavior.
- [x] Confirm project code reads native runtime collections but does not mutate them directly.
- [x] Create fresh branch `narumiruna/refactor/native-resource-reload` from current `main` before implementation.
- [x] Replace the generic resource reload callback with a narrow native reloader dependency and inject `PiService`.
- [x] Preserve native persistence paths for documents, packages, MCP, and project trust.
- [x] Add server regressions covering reload-after-success, operation ordering, no reload after failed/no-op mutations, and MCP reload.
- [x] Update Web/E2E coverage so prompt command discovery succeeds without a separate manual reload call.
- [x] Document the native persistence-plus-reload invariant and explicit ban on internal collection mutation.
- [x] Run focused tests, `npm run ci`, full local E2E, and the production Docker build; record exact results.
- [x] Review the complete diff for bypassed native APIs, direct runtime collection mutation, missed resource mutations, redundant reloads, active-run bypass, security regressions, and unrelated edits.
- [ ] Commit, push, and open one dedicated signed pull request linking this plan and Roadmap milestone.
- [ ] Resolve every pull-request check and feedback item with regression coverage, then merge the clean pull request.
- [ ] After merge, check the matching Roadmap milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] All current resource mutations persist before invoking the native reload lifecycle.
- [x] `PiService.reload()` remains the sole application adapter for ordinary resource reload.
- [x] Resource code cannot receive or invoke an arbitrary internal-collection mutation callback.
- [x] Prompt autocomplete refreshes after prompt creation without a second reload API request.
- [x] Failed or no-op mutations do not invoke reload; native reload errors remain visible to callers.
- [x] No parallel resource, command, package, settings, or reload state exists.
- [x] Server, Web/E2E, CI, and Docker verification pass.
- [ ] The dedicated pull request is merged with all feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.

## Verification

- `npm test -- tests/server/resources.test.ts tests/server/api.test.ts`: 46 tests passed.
- `npm run ci`: 23 files passed, 299 tests passed, 5 PostgreSQL-dependent tests skipped, and both builds passed.
- `npx playwright test`: all 18 setup, desktop, accessibility, and 390px mobile tests passed; prompt autocomplete refreshed without calling `/api/reload` explicitly.
- `docker build -t pi-agent:local .`: production image built successfully as `sha256:d07c7580681f4932aee9a1bc5d377b039f7ba32a9d0e95d6fb0f788177e57f7c`.
- A source audit found no writes to Pi loader-returned prompt, command, skill, or extension collections.
