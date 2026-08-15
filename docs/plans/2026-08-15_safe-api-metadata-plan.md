# Safe API Metadata Plan

Status: In progress.

## Goal

Implement the Phase 0 milestone “所有 API 只回傳 Web 所需的 opaque ID、相對路徑與安全 metadata” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-0共用基礎與安全邊界).

Eliminate server-generated identity and path details that the current Web does not need, and use opaque package IDs for package mutations without weakening explicit content-transfer features.

## Context

The existing workspace and conversation projections already return relative paths or opaque native IDs and have regression coverage.

The current session response includes an owner subject that the Web never reads.

The package list returns configured `source` and `installedPath` values, which can expose credentials or absolute container paths, and package mutations send those raw sources back as identifiers.

The diagnostics endpoint spreads Pi runtime and resource-loader diagnostics directly even though the current Web reads only MCP diagnostics, so native diagnostics can expose host paths and unnecessary internals.

## Architecture

Add shared Web response contracts for package summaries and MCP diagnostics.

Project each configured package to a deterministic opaque hash ID, bounded safe display name, scope, and filtered state; resolve update and remove IDs against the current native Pi package list on the server.

Keep package installation source as explicit owner input, but never echo it in metadata responses.

Project only the MCP diagnostics currently consumed by the Web, bound all fields, strip terminal control sequences, and replace absolute path-like tokens with a neutral marker.

Remove the unused owner subject from `/api/session` and its Web type.

Explicit owner-requested content endpoints such as transcript, document content, redacted MCP configuration, workspace file content/download, and native session export remain content transfers rather than metadata; this milestone does not corrupt user or tool content to enforce a metadata rule.

## Non-Goals

- Do not replace provider/model semantic IDs that are required for native Pi selection APIs.
- Do not rewrite conversation, tool, document, file, MCP configuration, or export content.
- Do not add a parallel package registry or persist new package IDs.
- Do not expose Pi diagnostics that have no current Web consumer.

## Risks

Deterministic package IDs must distinguish scope and source while never being reversible from the response.

Changing package mutation bodies can break update or remove UI actions if list state and ID resolution drift.

Over-broad diagnostic redaction can hide useful errors, while under-redaction can expose server paths.

Mitigate with service, API, and Web tests using absolute paths, credential-bearing URLs, unknown IDs, ANSI sequences, and both package scopes.

## Plan

- [x] Inventory all API routes, shared contracts, Web consumers, package projections, diagnostics, and existing path-safety tests; identify session owner, package metadata, and raw diagnostics as current unnecessary server metadata.
- [x] Create fresh branch `narumiruna/fix/safe-api-metadata` from current `main` before implementation.
- [x] Add shared safe package and diagnostic response contracts; `WebPackageSummary` and `WebMcpDiagnostic` are imported by the server projection and Library Web consumer.
- [x] Replace package source/path responses and mutation identifiers with deterministic opaque IDs plus safe bounded display names; focused projection, service, API, and Web tests verify scope separation, credential/path removal, successful update/remove resolution, stale-ID rejection, and request bodies.
- [x] Limit diagnostics to bounded projected MCP fields and redact terminal controls plus POSIX/Windows absolute paths; focused tests verify 100-item bounds, path redaction, and that raw Pi diagnostics are neither called nor returned.
- [x] Remove the unused owner subject from the session response and Web type; the exact disabled-auth session response test verifies authentication flags and active tools remain unchanged.
- [x] Add an API metadata regression audit covering representative session, package, diagnostics, conversation, and workspace responses without weakening explicit content endpoints; new regressions complement existing conversation-state, export, import, and workspace relative-path tests.
- [x] Run focused server/Web tests, `npm run ci`, and local E2E; 129 focused tests passed, CI passed 258 tests with 5 intentional skips and both builds, and final SQLite E2E passed all 17 tests after updating two stale owner-field expectations exposed by the first runs.
- [x] Review the complete diff for ID stability, hash input separation, stale package resolution, path/credential disclosure, content corruption, API compatibility, and unrelated changes; scope-separated hash tests, stale-ID guards, field/path scans, exact request tests, unchanged content subsystem files, final CI/E2E, and `git diff --check` found no unresolved issue.
- [ ] Commit, push, and open one dedicated signed pull request linking this plan and Roadmap milestone.
- [ ] Read all pull-request checks and feedback, fix every actionable item with regression coverage, and merge the clean pull request.
- [ ] After merge, check the matching Roadmap milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] Session metadata contains no unused owner subject.
- [x] Package list metadata contains no raw source, installed path, URL credential, or host absolute path.
- [x] Package update and remove accept only opaque IDs returned by the list endpoint.
- [x] Unknown or stale package IDs fail without invoking Pi package mutations.
- [x] Diagnostics returns only current Web-required MCP metadata with bounded path-safe text.
- [x] Existing relative workspace contracts and opaque conversation/session IDs remain intact.
- [x] Explicit content-transfer endpoints remain functional and are not silently rewritten.
- [x] Focused tests, `npm run ci`, and local E2E pass.
- [ ] The dedicated pull request is merged with all feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.
