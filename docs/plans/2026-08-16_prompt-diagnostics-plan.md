# Prompt Validation Diagnostics Plan

Status: In progress.

## Goal

Implement the Phase 3 milestone “補齊 prompt validation diagnostics” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-3prompts).

Show actionable, path-safe diagnostics for invalid prompt names, YAML frontmatter, UTF-8 content size, and Pi-native name collisions without replacing Pi discovery or reload behavior.

## Context

The merged prompt inventory already projects Pi’s active `PromptTemplate` snapshot with provenance and safe logical paths.

Pi 0.84.1 derives command names from filenames, parses optional `description` and `argument-hint` YAML frontmatter, silently omits templates whose YAML parser throws, and returns first-winner collision diagnostics from `resourceLoader.getPrompts()`.

The Web currently enforces create-name syntax and the one-megabyte write boundary, but it exposes no structured diagnostics and a malformed create or update can disappear after native reload.

The Roadmap now reserves full regression, E2E, accessibility, security, and release-readiness review for Phase 8, so this implementation milestone runs only directly related unit tests.

## Architecture

Add a shared pure validator that uses the installed browser-safe `yaml` 2.9 API, the existing prompt-name policy, and one UTF-8 byte limit to return stable diagnostic codes.

Keep active resources authoritative in Pi’s `ResourceLoader`; expose its native prompt collision diagnostics through the existing runtime adapter and map all paths to Web-safe logical labels.

Supplement diagnostics only for non-recursive canonical user and trusted-project `.md` files that Pi omitted before they entered its active snapshot; never add those files to commands or the editable resource inventory.

Return structured diagnostics with the prompt inventory, reject invalid prompt content before persistence, and render localized inventory plus live editor diagnostics.

Collision diagnostics are warnings because Pi has a deterministic winner; invalid names, frontmatter, and oversized content are errors and block writes.

## Non-Goals

- Do not change Pi prompt discovery order, collision precedence, command expansion, provenance, trust, or reload lifecycle.
- Do not create a prompt database, recursive scanner, general package validator, or duplicate command registry.
- Do not rename, repair, truncate, or delete invalid files automatically.
- Do not add prompt schema fields beyond Pi’s documented `description` and `argument-hint` string fields.
- Do not run Phase 8 regression, E2E, Docker, cross-database, accessibility, security, or release-readiness checks in this milestone.

## Risks

- Diagnostics could leak host paths; project only canonical logical paths, package labels, or bounded external basenames.
- A validation scanner could become parallel discovery; inspect only canonical top-level `.md` files for diagnostics and keep Pi’s active snapshot authoritative.
- YAML behavior could diverge from Pi; mirror Pi’s frontmatter boundaries and use the same installed `yaml` parser family.
- Character counts differ from filesystem and API byte limits; calculate content and filename limits with UTF-8 bytes.
- Collision warnings could incorrectly block intentional overrides; preserve Pi precedence and block only server-confirmed conflicts.
- Stale diagnostics could survive reload; rebuild them inside the same native snapshot read used by prompt inventory.

## Plan

- [x] Inspect the merged prompt inventory, mutation APIs, current server/Web tests, Pi 0.84.1 prompt-template docs, `ResourceLoader` diagnostics, frontmatter implementation, and installed `yaml` 2.9 exports/types/browser support.
- [x] Create fresh branch `narumiruna/feat/prompt-diagnostics` from merged `main` and add this dedicated plan before implementation.
- [ ] Add shared prompt diagnostic contracts, UTF-8 limits, and pure name/frontmatter/content validation.
- [ ] Expose Pi-native prompt diagnostics through the existing runtime adapter without leaking loader internals to the Web.
- [ ] Project active and omitted-canonical-file validation plus native collision results into bounded logical diagnostics.
- [ ] Reject invalid create/update content before persistence while preserving existing conflict, trust, and reload behavior.
- [ ] Return diagnostics from `/api/prompt-inventory` and keep command inventory based only on Pi’s active prompts.
- [ ] Render localized inventory diagnostics and live create/edit validation; block only error diagnostics.
- [ ] Add focused shared/server/Web unit coverage for invalid names, malformed or mistyped frontmatter, multibyte size limits, omitted files, path redaction, collision warnings, and write rejection.
- [ ] Run the directly related unit suites and formatting checks; record exact results.
- [ ] Audit scope against this plan and the Roadmap milestone, then update this plan’s evidence and checklist.
- [ ] Commit, push, open one dedicated signed implementation pull request linking this plan and Roadmap milestone, address blocking feedback, and merge.
- [ ] After merge, check the matching Roadmap milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [ ] Invalid prompt names, YAML frontmatter, UTF-8 content size, and native name collisions appear as structured, localized diagnostics.
- [ ] Malformed canonical user and trusted-project prompt files remain outside Pi’s active command inventory but have path-safe diagnostics.
- [ ] Invalid writes are rejected before persistence and do not trigger a broken post-save disappearance.
- [ ] Collision warnings identify Pi’s winner and hidden loser without exposing absolute host paths or changing precedence.
- [ ] Prompt inventory refresh replaces stale diagnostics after mutations and trust/reload changes.
- [ ] Directly related shared, server, API, and Web unit tests pass.
- [ ] Dedicated implementation PR is merged with blocking feedback resolved.
- [ ] The Roadmap milestone is checked and this plan is archived only after merge.

## Verification

- Pending implementation.
