# Pi Resource Provenance Plan

Status: Completed on 2026-08-15.

## Goal

Implement the Phase 0 milestone “所有 Pi 資源都必須保留 `user`、`project`、`package` 與 `temporary` provenance” from [`ROADMAP.md`](https://github.com/narumiruna/pi-agent/blob/main/ROADMAP.md#phase-0共用基礎與安全邊界).

Preserve Pi's native `sourceInfo.scope` and `sourceInfo.origin` through every current Web resource projection without exposing source paths.

## Context

The installed Pi version attaches canonical `sourceInfo` to extensions, commands, tools, skills, prompt templates, and themes.

Pi represents provenance with `scope: user | project | temporary` and `origin: package | top-level`, so package origin remains independent from the user or project setting that loaded it.

The current command API discards `sourceInfo`, legacy prompt templates imply user scope without returning it, and package summaries return scope without explicit package origin.

The current Web consumes command, legacy prompt-template, and configured-package metadata; skills, extensions, and themes do not yet have inventory pages and must not gain unused metadata endpoints.

## Architecture

Add one shared path-free `WebResourceProvenance` contract containing Pi's exact scope and origin dimensions.

Project Pi `SourceInfo` through a small server helper that copies only `scope` and `origin`, never `path`, `source`, or `baseDir`.

Attach provenance to invokable extension, prompt, and skill commands, to configured package summaries, and to legacy user prompt-template summaries.

Render concise provenance labels in current command autocomplete, package rows, and template rows so the Web consumes rather than merely transports the contract.

## Non-Goals

- Do not infer provenance from filesystem paths or resource names.
- Do not create new skill, extension, theme, or generic resource inventory APIs before their Roadmap phases.
- Do not expose Pi `sourceInfo.path`, `sourceInfo.source`, package installation paths, or package sources.
- Do not change discovery order, collision behavior, trust decisions, editability, or native reload behavior.

## Risks

Flattening package into a single scope would lose whether a package came from user or project settings.

Returning native `sourceInfo` wholesale would regress the safe metadata boundary by exposing absolute paths.

UI labels can become inconsistent if each surface invents its own provenance mapping.

Mitigate with an exact shared two-dimensional contract, one projection helper, all scope/origin combinations, sensitive-path assertions, shared Web labeling, and end-to-end regressions.

## Outcome

PR #22 merged as `3d45755` after its automatic `verify` check passed.

GitHub reported no submitted reviews, inline comments, conversation comments, or review threads, so no feedback required changes or replies.

The post-merge administrative change checks the matching Roadmap milestone and archives this plan.

## Plan

- [x] Read Pi's main README plus complete package, prompt-template, skill, extension, and SDK documentation and inspect the installed `SourceInfo`, `ResourceLoader`, prompt, skill, extension, and package declarations.
- [x] Inventory current server and Web resource projections; commands drop native provenance, legacy templates imply user/top-level, and package summaries omit explicit package origin.
- [x] Create fresh branch `narumiruna/feat/resource-provenance` from current `main` before implementation.
- [x] Add shared path-free resource provenance and command contracts plus one server projection helper; focused projection and label matrices verify every user, project, temporary, top-level, and package combination.
- [x] Preserve provenance on extension, prompt, and skill commands, configured package summaries, and legacy prompt-template summaries without exposing native source fields; projections copy only native scope/origin or fixed native-equivalent metadata.
- [x] Render the shared provenance consistently in command autocomplete, package rows, and prompt-template rows through `resourceProvenanceLabel()`.
- [x] Add server/API/Web regressions for all provenance categories, package scope independence, and absent path/source metadata; command, package, template, API, and component tests cover the contract.
- [x] Update resource documentation to explain Pi's two-dimensional provenance model and safe Web projection in README.
- [x] Run focused server/Web tests, `npm run ci`, and local E2E; 130 focused tests passed, CI passed 270 tests with 5 intentional skips and both builds, and all 17 SQLite browser tests passed after correcting the formatting failure reported by the first focused gate.
- [x] Review the complete diff for lost provenance, path leakage, inferred ownership, changed discovery order, UI ambiguity, API compatibility, and unrelated changes; all six scope/origin combinations are covered, source/path fields are absent, native loaders are unchanged, existing package scope remains compatible, one label helper serves every Web surface, and `git diff --check` passed.
- [x] Commit, push, and open one dedicated signed pull request linking this plan and Roadmap milestone; signed implementation commit `7e411ae` is on `narumiruna/feat/resource-provenance` in PR [#22](https://github.com/narumiruna/pi-agent/pull/22).
- [x] Read all pull-request checks and feedback, fix every actionable item with regression coverage, and merge the clean pull request; PR #22 `verify` passed, no feedback existed, and merge commit `3d45755` is on `main`.
- [x] After merge, check the matching Roadmap milestone and archive this plan through an administrative documentation pull request.

## Completion Checklist

- [x] The shared contract preserves Pi scope and origin as separate dimensions.
- [x] User, project, and temporary top-level resources remain distinguishable.
- [x] Package resources remain identifiable while retaining user or project scope.
- [x] Extension, prompt, and skill commands retain their native Pi provenance.
- [x] Configured package and legacy prompt-template summaries carry explicit provenance.
- [x] Web surfaces render provenance from one shared labeling rule.
- [x] No native source path, package source, installation path, or `baseDir` is returned.
- [x] Native Pi discovery, trust, collision, and reload behavior remain unchanged.
- [x] Focused tests, `npm run ci`, and local E2E pass.
- [x] The dedicated pull request is merged with all feedback resolved.
- [x] The Roadmap milestone is checked and this plan is archived only after merge.
