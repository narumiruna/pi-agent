# Files Workspace Plan

## Goal

Add an authenticated `Files` page that lets the owner safely browse, search, preview, create, edit, rename, download, and delete regular files inside the configured `WORKSPACE`.

The implementation must never expose host absolute paths, follow symlinks, reveal credential-like files, or silently overwrite a file changed outside the current browser editor.

## Context

`src/server/config.ts` already resolves `WORKSPACE`, and `src/server/index.ts` creates it before starting Hono.

`src/server/workspace/search.ts` already powers bounded chat `@file` search and excludes symlinks, common generated directories, credentials, `PI_CODING_AGENT_DIR`, and `DATA_DIR`.

`src/server/api.ts` currently exposes only `GET /api/workspace/files` for search.

`src/web/App.tsx` and `src/web/components/Navigation.tsx` use an in-memory `Page` union rather than a browser router, and desktop and mobile navigation already share `NavContent`.

Hono middleware already requires authentication, rejects cross-origin mutations, disables API caching, and applies request body limits.

No database migration or Pi session/resource abstraction is needed because workspace files remain ordinary files owned by the configured workspace.

## Architecture

### Server boundary

Add a workspace service under `src/server/workspace/` and inject one instance through `ApiServices` from `src/server/index.ts`.

The service owns listing, inspection, reading, mutation, download metadata, search policy, limits, and conversion from absolute filesystem paths to slash-separated relative API paths.

The service accepts only canonical relative paths, with `""` representing the workspace root.

Every operation rejects absolute paths, NUL bytes, `.` or `..` segments, backslash aliases, symlink components, non-regular targets, excluded runtime directories, and credential-like names.

Existing targets must pass `lstat`, `realpath`, root-containment, and exclusion checks.

New targets must validate every existing parent and reject a final symlink or a parent that resolves outside the workspace.

Sensitive or excluded paths return `404` so their existence is not disclosed, while malformed paths return `400`.

Directory responses are bounded, sorted with directories first, and contain only relative paths and safe metadata.

Text preview and editing are limited to valid UTF-8 regular files of at most 1 MB.

Binary, invalid UTF-8, and larger files return metadata without editor content.

Downloads use a bounded streaming response, a safe basename-only attachment header, `application/octet-stream`, and `X-Content-Type-Options: nosniff`.

A 100 MB download cap bounds bandwidth exposure while still allowing files that are too large for the editor to be downloaded.

Each inspected file receives an opaque revision derived from high-resolution file identity and stat metadata.

Create requests omit a revision and fail if the destination exists.

Update, rename, and delete requests require the last observed revision and return `409 conflict` when it no longer matches.

Browser mutations are serialized inside the service, revalidate paths and revisions immediately before the filesystem operation, preserve an existing file's mode, and use an atomic temporary-file rename for writes.

Rename changes only the basename within the current parent directory and must never replace an existing destination.

The existing search endpoint remains compatible but uses the same centralized path and sensitivity policy as the Files page.

### HTTP API

Add shared response contracts in `src/shared/contracts.ts` and the following authenticated endpoints in `src/server/api.ts`.

- `GET /api/workspace/entries?path=<relative>` lists one directory lazily and reports whether the result was truncated.
- `GET /api/workspace/file?path=<relative>` returns safe metadata, an opaque revision, and editor content only for supported text files.
- `PUT /api/workspace/file` creates or updates a file from `{ path, content, revision? }` and returns the new metadata and revision.
- `PATCH /api/workspace/file` renames a file from `{ path, name, revision }` and returns the new metadata and revision.
- `DELETE /api/workspace/file` deletes a file from `{ path, revision }` after revision validation.
- `GET /api/workspace/download?path=<relative>` streams an allowed regular file as an attachment.
- `GET /api/workspace/files?q=<query>&limit=<limit>` remains the compatible bounded autocomplete and Files search endpoint.

Use existing generic error codes with a bounded `reason` parameter such as `stale`, `exists`, `binary`, `too_large`, or `read_only` instead of returning filesystem messages or absolute paths.

Apply a dedicated JSON body limit to file writes that safely contains the 1 MB UTF-8 payload after JSON escaping, while retaining the service's byte-length check as the authoritative limit.

### Web UI

Add `files` to the current `Page` contract and render `src/web/pages/FilesPage.tsx` from `src/web/App.tsx`.

The page uses the existing Radix and React dependencies and does not add a browser editor package.

The desktop layout provides a bounded lazy tree or directory pane, breadcrumbs, search, file metadata, and a text editor.

The 390 px layout presents the same controls without horizontal page overflow and keeps every action available without keyboard shortcuts.

Selecting a directory loads only that directory's children.

Selecting a file loads its current metadata, revision, and optional text content.

Search reuses `/api/workspace/files`, and selecting a result opens its parent and then the result.

Create and rename accept one basename, while server validation remains authoritative.

Save preserves the draft on errors, and a stale-revision response offers reload rather than silently overwriting external changes.

Switching away from a dirty editor, reloading, renaming, or deleting requires an explicit discard or destructive-action confirmation.

Binary or oversized files show metadata and a download action without mounting an editor.

All loading, empty, truncated, read-only, error, stale, and success states have English and Traditional Chinese text and accessible status semantics.

## Non-Goals

- Directory creation, rename, move, upload, or deletion is not part of this plan.
- Multi-file tabs, syntax highlighting, formatting, Git operations, terminal access, and code execution are not part of this plan.
- Files outside `WORKSPACE`, symlinks, credentials, private Pi directories, and unrestricted absolute-path access are never supported.
- Filesystem watching and collaborative real-time editing are not part of this plan.
- Browser-history routing for every application page remains a separate navigation milestone; this plan extends the existing `Page` contract only.

## Assumptions

The authenticated owner may edit workspace files through the Web UI independently of Pi's `AGENT_TOOLS` allowlist.

`AGENT_TOOLS` continues to control model-generated tool calls, while filesystem permissions and read-only mounts remain authoritative for owner UI mutations.

Only regular files are downloadable or mutable in this phase.

The service limits are fixed constants with tests and are documented in `README.md`.

## Risks

A cooperating external editor can still modify a file between the final revision check and atomic rename because Node.js does not provide a portable workspace-wide compare-and-swap primitive.

The implementation mitigates this with high-resolution revisions, serialized browser mutations, immediate revalidation, no-clobber creation and rename, and atomic replacement, and documents the remaining local-process trust boundary.

A malicious trusted process can attempt a parent-directory symlink race.

The implementation mitigates this by rejecting symlink components, validating canonical parents immediately before access, using no-follow file opens where supported by Node.js, and treating Pi tools, extensions, packages, and local processes as the existing trusted-code boundary.

Large or unreadable directories can make browsing slow.

The implementation bounds entries, search scans, file sizes, downloads, and operation time, and exposes truncation or retry states instead of continuing without limits.

## Rollback / Recovery

The API and page are additive, so the UI and routes can be removed without a database or Pi-session migration.

Atomic writes leave the previous file intact when a write fails before replacement and remove temporary files on failure.

Rename and delete are destructive filesystem operations, so the UI requires confirmation and revision validation, while recovery relies on the workspace's Git history or external backup.

A failed or read-only mutation leaves the browser draft available for copying or retrying.

## Plan

### 1. Establish contracts and security policy

- [x] Add workspace entry, file preview, editability, revision, truncation, and mutation response types to `src/shared/contracts.ts`; verified by the production build and shared server/Web imports.
- [x] Extract the exclusion and credential-name rules from `src/server/workspace/search.ts` into a shared workspace policy module; verified by credential, package-output, and configured-directory tests in `tests/server/workspace.test.ts`.
- [x] Add canonical relative-path parsing and existing/new target containment helpers under `src/server/workspace/`; verified by traversal, alias, Unicode, symlink, missing-parent, and root tests.
- [x] Inspect the installed Hono and `@hono/node-server` streaming types and implementation before selecting the download response API; verified Hono `ReadableStream` responses and Node adapter cancellation before implementation.

### 2. Implement the workspace service

- [x] Add a workspace service that lists one bounded directory and returns only relative safe metadata sorted directory-first; verified by empty, nested, Unicode, excluded, read-only, oversized-directory, and truncation tests.
- [x] Add file inspection that detects valid UTF-8 text, binary content, oversized content, and regular-file status without returning unsupported content; verified at byte boundaries with invalid UTF-8, NUL, BOM, directory, and opaque-revision cases.
- [x] Add serialized create and update operations with byte limits, create-only semantics, revision checks, mode preservation, atomic replacement, and temporary-file cleanup; verified by conflict, concurrency, external-change, read-only, mode, and cleanup tests.
- [x] Add same-directory rename and revision-protected delete operations that reject destination replacement and revalidate containment; verified by stale, missing, excluded, symlink, collision, and successful mutation tests.
- [x] Add bounded download descriptors or streams that never expose an absolute path to callers; verified by empty, binary, oversized, cancellation, fixed-length stream, and attachment tests.
- [x] Refactor `searchWorkspace` to consume the same policy and limits without changing the chat autocomplete contract; verified by fuzzy, directory, abort, result-limit, and secret-exclusion tests.

### 3. Expose and harden the Hono API

- [x] Construct the workspace service in `src/server/index.ts` and inject it through `ApiServices`; verified by server builds and SQLite/PostgreSQL application startup.
- [x] Add TypeBox query and body validation for the entries, file, rename, delete, and download endpoints in `src/server/api.ts`; verified by malformed, oversized, unknown-field, invalid-revision, and invalid-limit API tests.
- [x] Map workspace domain failures to stable `400`, `403`, `404`, `409`, `413`, and `415` responses without filesystem text; verified by table-driven API tests.
- [x] Add the download response with attachment-safe headers, no sniffing, cancellation, and no host path leakage; verified with quoted, Unicode, newline-like, nested-name, and streamed-byte tests.
- [x] Extend `src/server/app.ts` with the dedicated file-write body limit while retaining authentication, no-store, and same-origin mutation middleware; verified by authentication, origin, escaped 1 MB, and oversized-body tests.
- [x] Search the complete workspace API diff for direct `resolve` or filesystem access outside the service and consolidate duplicate policy paths; verified that filesystem access remains under `src/server/workspace/` except existing startup/configuration code.

### 4. Build the Files page

- [x] Add the `Files` navigation item, icon, `Page` value, App rendering branch, and English and Traditional Chinese labels in `src/web/components/Navigation.tsx`, `src/web/App.tsx`, and `src/web/i18n.ts`; verified by App, desktop, and mobile navigation tests.
- [x] Add `src/web/pages/FilesPage.tsx` with lazy directory loading, directory-first tree/list rendering, breadcrumbs, search, loading, empty, error, and truncated states; verified by focused Web tests.
- [x] Add text preview and editor state with metadata, dirty tracking, save, stale-revision recovery, retry, and before-unload protection; verified by stale-draft, explicit-discard, reload, and App navigation tests.
- [x] Add create, same-directory rename, download, and confirmed delete controls with pending-state duplicate-submit protection; verified by Web request-contract tests and desktop filesystem E2E.
- [x] Add binary, invalid-text, oversized, and read-only presentations that omit the editor but retain metadata and allowed download actions; verified by service, Web, and browser tests.
- [x] Add focused Files styles to `src/web/styles.css` for desktop and 390 px layouts, visible focus, scroll containment, long Unicode paths, and reduced motion; verified by mobile overflow and axe checks.

### 5. Add end-to-end coverage and documentation

- [x] Seed isolated nested text, binary, oversized, excluded, and credential-like workspace fixtures in `tests/e2e/support/runtime.ts`; verified that fixture setup resolves only beneath `.local/e2e/runtime/workspace`.
- [x] Add `tests/e2e/desktop/files.spec.ts` covering lazy browse, search, create, edit, external stale conflict, rename, download, delete, secret invisibility, and persisted filesystem results; passed in SQLite and PostgreSQL runs.
- [x] Add a mobile Files spec covering navigation, browse, edit, confirmation, keyboard operation, and 390 px overflow; passed with an axe scan.
- [x] Extend `tests/e2e/desktop/accessibility.spec.ts` to scan the Files page, text editor, confirmation dialog, and metadata-only states; passed with no serious violations.
- [x] Update `README.md` to document the Files page, workspace-relative API boundary, hidden paths, text/download limits, revision conflicts, owner UI versus `AGENT_TOOLS`, read-only mounts, destructive recovery, and remaining trusted-code race boundary; reviewed for host-specific paths and credentials.
- [x] Update only the verified Files items and acceptance evidence in `ROADMAP.md` after implementation and tests pass; broader navigation and other roadmap phases remain unchecked.

### 6. Verify and finish

- [x] Run focused server and Web tests with the Files page suite included; 5 files and 98 tests passed.
- [x] Run `npm run ci`; Biome, E2E TypeScript, 16 Vitest files with 213 tests, server build, and Web build passed with PostgreSQL storage contracts enabled.
- [x] Run `just e2e` against SQLite; 16 setup, desktop, and mobile tests passed.
- [x] Run `E2E_DATABASE_URL=<dedicated-pi_agent_e2e-database> just e2e-postgres` against a disposable PostgreSQL database; 16 setup, desktop, and mobile tests passed.
- [x] Run `docker build -t pi-agent:local .` because production server and static Web behavior changed; the image built and a UID `10001` smoke check confirmed no test fixtures or workspace files were copied.
- [x] Review the final diff for absolute-path disclosure, traversal, symlink races, unsafe attachment headers, unbounded reads, stale overwrite, temporary-file leakage, lost drafts, inaccessible controls, duplicate abstractions, and unrelated changes; dispositions are recorded below.
- [x] Mark every applicable task and completion check only after its evidence passes, then move this completed plan to `docs/plans/archived/2026-08-15_files-plan.md`; archived after all evidence was recorded.

## Evidence

- Focused verification: 5 test files and 98 tests passed.
- Repository gate: `npm run ci` passed 16 test files and 213 tests with `TEST_POSTGRES_URL` set.
- Browser verification: SQLite and PostgreSQL each passed all 16 Playwright tests.
- Production verification: `docker build -t pi-agent:local .` passed, and the image ran as UID `10001` with an empty `/workspace` and no `/app/tests`.
- Accessibility: desktop editor, metadata-only, discard dialog, and mobile 390 px scans reported no serious axe violations or horizontal page overflow.
- Absolute paths and traversal: one workspace policy validates canonical relative paths, exclusions, real paths, parent containment, and symlink components before service operations.
- Symlink races: final reads use `O_NOFOLLOW`, opened-file identity is compared with validated metadata, and paths are revalidated immediately before mutations; the unavoidable portable parent-directory race remains within the documented trusted local-process boundary.
- Attachments and bounds: filenames use escaped ASCII fallback plus RFC 5987 encoding, responses use `nosniff`, reads and directories are bounded, and streams stop at the validated length and 100 MB cap.
- Writes and drafts: mutations are serialized, create and rename do not replace destinations, updates are atomic and revision-checked, temporary files are cleaned up, and Web failures preserve drafts until explicit discard.
- Scope: no dependency, database migration, Pi resource/session state, shell endpoint, or unrelated repository behavior was added.
- Plan archive: this completed plan is stored at `docs/plans/archived/2026-08-15_files-plan.md`.

## Completion Checklist

- [x] Every endpoint accepts only canonical workspace-relative paths and returns no host absolute path.
- [x] Traversal, symlink, excluded-directory, credential, body-size, file-size, directory-size, and download-size boundaries have regression coverage.
- [x] Text create, edit, rename, download, and delete work without silent overwrite or destination replacement.
- [x] Binary and oversized files expose only safe metadata and bounded download behavior.
- [x] Desktop and 390 px Files flows are keyboard-operable, screen-reader-labelled, and free of serious axe violations or page overflow.
- [x] Chat `@file` autocomplete remains backward compatible and uses the same workspace policy.
- [x] SQLite and PostgreSQL E2E suites pass.
- [x] `npm run ci` and `docker build -t pi-agent:local .` pass.
- [x] `README.md` and the verified Files section of `ROADMAP.md` match the implemented behavior and limits.
- [x] The final diff contains no unrelated user changes, new dependency, database migration, or parallel Pi resource/session state.
- [x] The completed plan is archived under `docs/plans/archived/` only after all evidence above is recorded.
