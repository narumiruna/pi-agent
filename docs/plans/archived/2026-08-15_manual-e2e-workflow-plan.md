# Manual E2E Workflow Plan

Status: In progress.

## Goal

Keep GitHub's automatic pull-request and `main` CI limited to the existing `verify` job, while preserving the SQLite and PostgreSQL Playwright suites in a separate GitHub Actions workflow that can only be started manually with `workflow_dispatch`.

## Context

At planning time, `.github/workflows/ci.yaml` ran `verify` automatically and also ran an `e2e` matrix for SQLite and PostgreSQL on every pull request and push to `main`.

Local E2E entry points already exist as `just e2e`, `just e2e-postgres`, and `npm run test:e2e` and must remain unchanged.

This operational task follows the delivery rules in `ROADMAP.md#強制交付流程` but does not implement a product milestone.

## Architecture

`.github/workflows/ci.yaml` will retain its existing `pull_request` and `push` triggers and only the `verify` job.

A new `.github/workflows/e2e.yaml` will declare only `workflow_dispatch`, retain read-only repository permissions, and run the existing SQLite and PostgreSQL matrix with the same PostgreSQL service, Chromium installation, test command, and failure artifacts.

The manual workflow will run both stores on each dispatch rather than add unrequested inputs or scheduling behavior.

## Non-Goals

- Do not remove, rename, or change the Playwright suites or local E2E commands.
- Do not add `schedule`, `pull_request`, `push`, `workflow_call`, or release triggers to the manual workflow.
- Do not change the automatic `verify` job, PostgreSQL contract tests, or Docker build.

## Risks

Removing automatic E2E permits browser regressions to merge unless an owner manually dispatches the workflow.

The accepted mitigation is to keep both database variants available in one manual workflow and preserve local E2E commands for pre-PR verification.

## Rollback / Recovery

Move the unchanged E2E matrix job back into `.github/workflows/ci.yaml` if automatic browser coverage is required again.

## Plan

- [x] Inspect `.github/workflows/ci.yaml`, `package.json`, and `justfile` to identify the automatic E2E job and unchanged local entry points; evidence: the workflow has one `e2e` matrix and local commands remain separate from `npm run ci`.
- [x] Create fresh branch `narumiruna/ci/manual-e2e-workflow` from current `origin/main`; evidence: branch started after fast-forwarding `main` to `09a8fac`.
- [x] Remove only the `e2e` job from `.github/workflows/ci.yaml` so automatic GitHub CI retains `verify`; parsed YAML confirms `verify` is the only job and no Playwright command remains.
- [x] Add `.github/workflows/e2e.yaml` with only `workflow_dispatch` and the preserved SQLite/PostgreSQL matrix; parsed YAML confirms the sole trigger, read-only permission, both stores, Chromium command, test command, and failure artifact step.
- [x] Run `npm run ci` and `just e2e` to verify repository checks and the unchanged local SQLite browser suite; evidence: 244 Vitest tests passed with 5 intentional skips, both builds passed, and all 17 SQLite Playwright tests passed.
- [x] Review the complete diff for accidental automatic triggers, workflow permission expansion, command drift, secret requirements, and unrelated changes; `git diff --check` passed, targeted scans found no automatic trigger or E2E command in `ci.yaml`, and only read-only contents permission is present.
- [x] Commit only the plan and workflow files with a signed Conventional Commit, push the branch, and open one dedicated pull request linking this plan; evidence: signed commit `06c2669` is pushed in PR #12.
- [x] Read and classify all pull-request checks, reviews, inline comments, and conversation threads; PR #12 `verify` passed and GitHub reported zero reviews, inline comments, conversation comments, or review threads, so no feedback required a response.

## Completion Checklist

- [x] Automatic GitHub CI has no E2E job or Playwright installation step.
- [x] The manual E2E workflow has no trigger other than `workflow_dispatch`.
- [ ] One manual dispatch runs both SQLite and PostgreSQL E2E variants and preserves failure artifacts.
- [x] Local E2E scripts and test files are unchanged.
- [x] Focused workflow validation, `npm run ci`, and local SQLite E2E pass.
- [x] The dedicated pull request is open, required checks pass, and every review item has an evidence-backed outcome.
- [ ] The pull request is merged before this plan is archived.
