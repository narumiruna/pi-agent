# Monaco Files Editor Plan

Status: Completed on 2026-08-15.

## Goal

Replace the Files page's plain text area with a self-hosted Monaco Editor experience on supported desktop browsers while preserving the existing workspace security boundary, revision-protected saves, unsaved-draft protection, read-only states, and mobile usability.

The completed editor must provide syntax highlighting, line numbers, search, folding, editor settings, keyboard save, accessible status information, and a stale-file diff and merge flow without sending workspace content to a CDN or executing workspace code.

## Context

`src/web/pages/FilesPage.tsx` currently stores the selected file and controlled draft in React state and renders a Radix `TextArea` for valid UTF-8 files of at most 1 MB.

`src/web/App.tsx` already detects the system light or dark appearance and blocks navigation while the Files draft is dirty.

The existing Files API returns workspace-relative paths, editable content, an opaque revision, and stable stale-conflict errors, so Monaco does not require a new filesystem or session abstraction.

A stale save can fetch the latest disk version through the existing `GET /api/workspace/file` endpoint while retaining the local draft.

The current desktop, mobile, and accessibility tests locate the editor by its translated accessible label and assume native textarea value semantics.

The repository uses React 19, Vite 8, static top-level TypeScript imports, and a production Hono server that serves the built Web assets.

`monaco-editor` and `@monaco-editor/react` were not installed at planning time.

The surveyed current releases are `monaco-editor@0.56.0` and `@monaco-editor/react@4.7.0`, both under the MIT license, but implementation must verify the versions actually installed by the lockfile.

The React wrapper defaults to a remote Monaco CDN unless explicitly configured, and Monaco officially does not support mobile browsers.

The Files implementation was proposed by open pull request #8, so this work used an explicitly stacked branch from its passing commit `a454b0c`.

## Architecture

### Monaco runtime

Add one Web-only Monaco bootstrap module that statically imports the installed Monaco ESM API, required language contributions, and Vite `?worker` constructors.

Configure `self.MonacoEnvironment.getWorker` for editor, JSON, CSS, HTML, and JavaScript or TypeScript labels before the first editor mounts.

Configure `@monaco-editor/react` with the imported local Monaco instance so neither editor code nor workspace content is requested from a CDN.

Use only verified installed exports and language contribution paths, and do not raise Vite's chunk warning limit merely to hide Monaco's size.

Use a synthetic `pi-workspace:` model URI derived from the canonical relative workspace path so Monaco never receives a host absolute path.

Dispose models, editor subscriptions, and resize resources when a file is replaced, renamed, deleted, or the page unmounts.

### Editor boundary

Add a focused `CodeEditor` component that accepts the path, controlled value, read-only state, appearance, accessible label, settings, save callback, and change callback.

The component owns Monaco options, cursor-position reporting, `Ctrl/Cmd+S`, loading and failure presentation, model lifecycle, and the native plain-editor fallback.

The Files page remains authoritative for the draft, dirty state, revision, pending mutations, discard confirmation, and API calls.

Map known filenames and extensions to Monaco language identifiers through a pure tested function, and use `plaintext` for unknown files.

Initial mappings cover JavaScript, TypeScript, JSX, TSX, JSON, Markdown, YAML, HTML, CSS, Python, Rust, Go, shell scripts, Dockerfiles, SQL, XML, and common configuration files supported by the installed Monaco version.

### Responsive and accessible fallback

Use Monaco on supported desktop layouts and retain a native textarea editor at the existing 390 px mobile layout.

Do not use user-agent sniffing.

Provide an explicit plain-editor control on desktop and automatically fall back when the viewport is narrow or the Monaco component fails to initialize.

Both editor modes use the same controlled draft, read-only state, accessible label, save action, and dirty-navigation behavior.

Expose and document a keyboard-accessible Tab-focus control, preserve Monaco's built-in command, and verify that the editor does not create an unexplained keyboard trap.

### Settings and status

Store only bounded presentation preferences under a versioned local-storage key.

Preferences include font size, tab size, word wrap, minimap visibility, whitespace rendering, and desktop Monaco versus plain-editor mode.

Malformed or unsupported stored values fall back to safe defaults without preventing Files from loading.

Show the detected language, UTF-8 encoding, line-ending style, and current line and column without changing the file API or contents.

### Stale-file diff and merge

When a revision-protected save returns `stale`, retain the local draft and fetch the latest file version separately.

Open a labelled Monaco Diff Editor on desktop with the latest disk content as the original model and an editable copy of the local draft as the modified model.

Allow the owner to cancel and retain the original stale draft, reload the disk version, or apply the merged draft against the newly fetched revision.

Applying a merged draft updates the selected baseline and revision but remains dirty until an ordinary revision-protected save succeeds.

Use labelled native text areas for the same conflict choices on the mobile or plain-editor path.

If the refreshed target is missing, binary, oversized, or unreadable, keep the local draft and show a recoverable error instead of replacing or silently saving it.

A second external change after merge review must still produce another revision conflict.

## Tech Stack

- `monaco-editor` provides the editor, built-in tokenizers, browser language workers, models, and Diff Editor.
- `@monaco-editor/react` provides React 19-compatible editor and diff lifecycle integration.
- Vite's built-in `?worker` handling emits self-hosted production worker assets.
- Existing React, Radix Themes, i18next, Vitest, Playwright, and axe tooling provide UI, localization, and verification.
- No additional language-client, formatter, editor-theme, storage, or state-management dependency is planned.

## Non-Goals

- Full VS Code, code-server, OpenVSCode Server, Theia, terminal, Git UI, debugger, extension host, and arbitrary code execution are not part of this plan.
- Language Server Protocol transport and project-wide Python, Rust, or Go semantic intelligence are not part of this plan.
- VS Code extensions cannot be installed into the embedded Monaco editor.
- Multi-file tabs, split editing outside the stale-conflict dialog, collaborative editing, autosave, and filesystem watching are not part of this plan.
- The workspace API, security policy, file limits, hidden paths, and revision algorithm do not change unless implementation evidence exposes a required regression fix.
- Monaco is not forced onto officially unsupported narrow mobile layouts.

## Assumptions

The owner wants an editor-grade Files experience rather than a separately deployed full IDE.

The open Files pull request was the implementation base and remained unchanged while this stacked branch added the editor.

JavaScript and TypeScript receive Monaco's bundled browser language service, while other mapped languages initially receive syntax and editor support only.

The existing 1 MB UTF-8 preview limit remains authoritative and bounds Monaco document size.

The native editor remains a supported fallback rather than temporary migration code.

No database migration, server-side language process, or new workspace permission is required.

## Resolved unknowns

Installed-package inspection established the selective ESM contribution paths, five worker routes, wrapper disposal flags, and editor accessibility options.

Production builds established the entry, Monaco, CSS, and worker size impact recorded in the outcome.

Chromium keyboard and axe coverage verified the explicit Tab-focus control and required explicit inner-editor ARIA option updates for Monaco Diff Editor 0.56.0.

## Risks

Monaco can substantially increase initial JavaScript and worker assets.

The implementation mitigates this by measuring the baseline, importing only verified required contributions where practical, keeping Monaco assets in explicit chunks, and recording compressed production sizes without suppressing warnings.

Incorrect worker configuration can leave syntax services unavailable only in the production build.

The implementation mitigates this with a built-output Playwright test and a production container smoke test that exercises each configured worker class.

The React wrapper's default CDN behavior could disclose application metadata or fail offline.

The implementation mitigates this by injecting the local Monaco instance before mount and failing tests on any editor request to a non-application origin.

Monaco is not supported on mobile and can create keyboard or screen-reader regressions if treated like a native textarea.

The implementation mitigates this with an automatic native fallback, an explicit desktop fallback, labelled controls, keyboard-escape verification, and real-browser accessibility tests.

Unreleased models or listeners can leak content and memory during repeated file switches.

The implementation mitigates this with one ownership boundary, explicit disposal, Strict Mode lifecycle tests, and a repeated-switch browser regression test.

A stale diff could accidentally turn conflict review into an unprotected overwrite.

The implementation mitigates this by adopting only the freshly fetched revision after explicit merge confirmation and using the normal revision-protected save endpoint for the final write.

Malformed local-storage settings could prevent the editor from mounting.

The implementation mitigates this with versioned parsing, bounded values, defaults, and regression tests.

## Rollback / Recovery

The existing native editor remains available, so a Monaco runtime failure can fall back without losing the React draft.

The Monaco component, bootstrap, settings, and dependencies are Web-only and can be removed without a server, database, workspace-file, or Pi-session migration.

A failed save, diff load, editor initialization, or mode switch retains the draft for copying or retrying.

Removing the versioned local-storage key restores defaults and does not affect workspace files.

## Outcome

The Files page now uses self-hosted Monaco on desktop and a controlled native editor on narrow screens or runtime failure.

The stale-save flow fetches the latest revision, offers an editable desktop or native diff, and requires a normal protected save after merge review.

`npm ls` reports one deduplicated `monaco-editor@0.56.0`, `@monaco-editor/react@4.7.0`, and the audited `dompurify@3.4.13` override.

The focused Files and editor run passed 2 files and 40 tests.

`npm run ci` passed Biome, E2E TypeScript, 17 Vitest files, 241 tests, 5 intentional skips, and both production builds.

SQLite and PostgreSQL Playwright runs each passed all 17 tests, including Monaco workers, no external requests, dark and light themes, stale merge, keyboard focus, axe scans, and the 390 px native fallback.

`docker build -t pi-agent:local .` passed, and a UID 10001 browser smoke test loaded editor, JSON, CSS, HTML, and TypeScript workers from the container origin with no external request.

The baseline entry JavaScript was 672.47 kB and 203.67 kB gzip, while the final entry is 707.65 kB and 214.57 kB gzip.

The explicit Monaco JavaScript chunk is 3,953.46 kB and 1,009.08 kB gzip, and its CSS chunk is 161.82 kB and 24.43 kB gzip.

The final app CSS is 715.08 kB and 89.35 kB gzip, compared with the 713.12 kB and 89.06 kB gzip baseline.

The emitted editor, JSON, HTML, CSS, and TypeScript workers are respectively 300.37, 429.59, 739.94, 1,074.88, and 6,913.95 kB before compression.

Measured deterministic gzip sizes for those workers are 91.20, 126.60, 194.40, 243.74, and 1,481.40 kB.

The existing 650 kB warning remains honest for Monaco and was not suppressed or raised.

Final review found no CDN path, host absolute model path, new server API, database migration, workspace permission, code execution, LSP server, extension host, or silent stale overwrite.

## Plan

### 1. Establish the implementation baseline and dependency contract

- [x] Verify pull request #8 state and create the implementation branch from a base containing the completed Files page; branch `narumiruna/feat/monaco-files-editor` is explicitly stacked at #8 commit `a454b0c` while #8 remains open with all checks passing.
- [x] Run `npm ci`, the existing focused Files Web tests, and `npm run build` before dependency changes; clean install reported 0 vulnerabilities, 7 Files tests passed, and the baseline Web build emitted 672.47 kB JavaScript (203.67 kB gzip) plus 713.12 kB CSS (89.06 kB gzip).
- [x] Install `monaco-editor` and `@monaco-editor/react` through npm so `package.json` and `package-lock.json` capture compatible versions; `npm ls` reports one deduplicated `monaco-editor@0.56.0` with `@monaco-editor/react@4.7.0`, and a `dompurify@3.4.13` security override removes the installed Monaco version's vulnerable exact transitive pin with `npm audit` reporting 0 vulnerabilities.
- [x] Read the complete installed package README files, package exports, type declarations, Vite examples, loader configuration, worker implementation, model disposal paths, Diff Editor props, and accessibility options under `node_modules`; selected local `loader.config({ monaco })`, Vite worker constructors, `ariaLabel`, diff ARIA labels, `tabFocusMode`, synthetic model paths, wrapper-owned model disposal with keyed unmounts, and modified-editor subscriptions instead of the default CDN or unverified APIs.
- [x] Build a minimal self-hosted Monaco and worker integration using static top-level imports, then inspect `dist/public` and browser requests to choose verified contribution imports and chunking; production E2E loaded all five workers locally, the final sizes are recorded above, and `chunkSizeWarningLimit` remains 650.

### 2. Add tested editor configuration primitives

- [x] Add a pure workspace-path-to-Monaco-language mapper under `src/web/` with explicit special-filename, compound-extension, case, and plaintext fallback rules; verify JavaScript, TypeScript, JSON, Markdown, YAML, HTML, CSS, Python, Rust, Go, shell, Dockerfile, SQL, XML, and unknown cases in a focused Web test.
- [x] Add a versioned editor-settings parser and serializer with bounded font size, supported tab sizes, word wrap, minimap, whitespace, and editor-mode values; verify defaults, round trips, malformed JSON, unknown versions, and out-of-range values in a focused Web test.
- [x] Add the Monaco bootstrap module with the locally imported instance, verified contribution imports, and exhaustive worker-label routing; verify unit coverage for routing and a production browser smoke test for editor, JSON, CSS, HTML, and TypeScript workers.
- [x] Add a synthetic URI helper that encodes only canonical workspace-relative paths under a non-host `pi-workspace:` scheme; verify Unicode, spaces, nested paths, special characters, and the absence of host absolute paths.

### 3. Build the reusable Monaco editor boundary

- [x] Add a `CodeEditor` component with controlled value, path, read-only, appearance, settings, accessible label, change, save, and cursor callbacks; verify editable and read-only behavior with a narrow installed-wrapper mock and real Chromium coverage.
- [x] Configure line numbers, active-line highlighting, bracket matching, folding, search, multi-cursor editing, automatic layout, word wrap, minimap, whitespace, font, tab size, accessibility support, and synthetic model paths from the tested settings; verify representative options through the wrapper boundary and visible browser behavior.
- [x] Register `Ctrl/Cmd+S` through the Monaco command API using current callback state, prevent the browser save dialog, and leave ordinary browser copy, cut, paste, and undo behavior intact; verify one save per shortcut and no save while read-only or pending.
- [x] Report cursor line and column, detected language, UTF-8, and LF or CRLF status without mutating content; verify status updates after cursor movement and file replacement.
- [x] Implement native-editor selection for narrow viewports, explicit plain-editor preference, and Monaco initialization failure, with one shared draft and accessible label; verify mode changes preserve content, read-only behavior, dirty state, and focus.
- [x] Dispose editor actions, content and cursor subscriptions, models, and resize resources across React Strict Mode mount cycles, file switches, rename, delete, and unmount; verify balanced creation and disposal in component tests and stable repeated switching in Playwright.
- [x] Add an accessible loading and failure presentation with a plain-editor recovery action; verify a simulated bootstrap failure leaves the full draft editable and savable through the existing API.

### 4. Integrate Monaco into Files

- [x] Pass the current light or dark appearance from `src/web/App.tsx` into `FilesPage` and the editor boundary; verify system appearance changes update Monaco without replacing the draft.
- [x] Replace the supported-text `TextArea` in `src/web/pages/FilesPage.tsx` with `CodeEditor` while retaining existing binary, oversized, read-only, pending, save, discard, rename, delete, and before-unload behavior; verify existing request contracts and dirty-navigation tests still pass through an editor test adapter.
- [x] Add compact editor settings and plain-editor controls using the existing Radix dialog and labelled native form controls, persist only validated presentation settings, and keep every action reachable at desktop and 390 px widths; native selects avoid nested portal interception, and tests verify keyboard operation, reload persistence, malformed-storage recovery, and no horizontal page overflow.
- [x] Add a localized editor status bar and keyboard help for save, find, and Tab-focus behavior; verify English and Traditional Chinese labels and screen-reader associations.
- [x] Reset or replace the Monaco model safely after confirmed discard, fresh disk reload, successful rename, successful delete, or a newly created file; verify no old path, content, revision, undo history, or cursor status leaks into the next file.

### 5. Add stale diff and merge recovery

- [x] On a `stale` save response, fetch the latest file into separate conflict state without calling the normal file loader or replacing the local draft; verify success, repeated conflict, missing file, unsupported content, and refresh failure paths.
- [x] Add a labelled desktop Monaco Diff Editor whose original side is the latest disk version and whose modified side is an editable copy of the local draft; verify both synthetic model URIs are distinct, content changes are captured, and all diff models and listeners are disposed on close.
- [x] Add equivalent labelled native original and modified text areas for mobile and plain-editor mode; verify 390 px layout, keyboard access, and no horizontal page overflow.
- [x] Add cancel, reload disk, and apply merged draft actions so cancel preserves the old draft and revision, reload adopts disk content, and apply adopts only the fresh revision while keeping merged content dirty; verify each state transition in Web tests.
- [x] Require the merged draft to pass through the ordinary revision-protected save and surface another diff if the disk changes again; verify an E2E external-write race never silently overwrites the newer file.

### 6. Update tests and documentation

- [x] Refactor `tests/web/files.test.tsx` to use a faithful accessible `CodeEditor` test adapter while preserving assertions for save payloads, stale drafts, read-only files, switching, creation, rename, download, and delete; verify the complete Files Web suite passes.
- [x] Add focused component tests for language mapping, settings, local Monaco loader selection, current callback handling, model lifecycle, failure fallback, appearance changes, and keyboard save; verify they pass without depending on CDN, timers, or unreleased DOM resources.
- [x] Update `tests/e2e/desktop/files.spec.ts` to exercise the real Monaco editor, syntax mode, keyboard save, persisted settings, read-only presentation, file switching, and editable stale diff merge against the filesystem; verify Chromium saves exactly the expected bytes.
- [x] Update `tests/e2e/mobile/files.spec.ts` to assert the native fallback remains editable, revision protected, dirty-navigation guarded, and free of 390 px overflow; verify Monaco workers are not required for the mobile flow.
- [x] Extend Files accessibility coverage to scan Monaco, settings, status, Diff Editor, native fallback, and conflict actions, and add keyboard verification for focus entry and exit; verify no serious axe violations or keyboard trap.
- [x] Add a browser network assertion that opening and editing Files makes no Monaco, worker, font, telemetry, or content request to an external origin; verify the test fails on the wrapper's default CDN behavior.
- [x] Update `README.md` to document Monaco features, supported language level, self-hosting, keyboard commands, settings, mobile and failure fallback, stale diff recovery, and the absence of LSP, code execution, VS Code extensions, or a full IDE; review the text for unsupported promises and host paths.

### 7. Verify and finish

- [x] Run focused Web and Files tests with `npm test -- tests/web/files.test.tsx tests/web/code-editor.test.tsx`; 2 files and 40 tests passed.
- [x] Run `npm run ci`; Biome and E2E TypeScript passed, Vitest passed 17 files and 241 tests with 5 intentional skips, both builds passed, and the honest Monaco chunk warning remains.
- [x] Run `just e2e` against SQLite; all 17 desktop, mobile, accessibility, worker, and no-external-request tests passed.
- [x] Run `E2E_DATABASE_URL=<dedicated-test-database> just e2e-postgres`; all 17 tests passed against a temporary dedicated PostgreSQL 17 database.
- [x] Run `docker build -t pi-agent:local .`; the final image built with 0 audit findings, and a UID `10001` Chromium smoke loaded Files and all five workers from the application origin using only bind-mounted temporary files.
- [x] Compare final compressed entry, Monaco, contribution, and worker asset sizes with the recorded baseline; the outcome above records the accepted impact, one installed Monaco copy, and the unchanged warning threshold.
- [x] Review the complete diff for CDN access, host-path disclosure, unsafe model URIs, draft loss, stale overwrite, duplicate saves, model or listener leaks, unsupported mobile mounting, keyboard traps, inaccessible diff controls, unbounded storage values, server-surface expansion, and unrelated changes; unit, browser, audit, build, and manual diff evidence found no unresolved issue.
- [x] Mark tasks only after their acceptance evidence passes, update only documentation that matches verified behavior, and move the fully completed plan to `docs/plans/archived/2026-08-15_monaco-editor-plan.md`; every applicable task and completion item now has passing evidence.

## Completion Checklist

- [x] Supported desktop Files content uses self-hosted Monaco with local workers and no CDN or telemetry request.
- [x] Known workspace filenames receive tested language mapping and unknown files remain safely editable as plaintext.
- [x] Monaco provides line numbers, search, folding, syntax highlighting, settings, cursor status, and one-shot `Ctrl/Cmd+S` saves.
- [x] Light and dark appearance changes, read-only files, create, rename, delete, file switching, and successful saves preserve existing Files behavior.
- [x] Every model, worker-facing editor resource, event subscription, and resize resource has a verified lifecycle with no stale path or content reuse.
- [x] Narrow mobile layouts and initialization failures retain a labelled native editor with the same draft, save, read-only, and revision semantics.
- [x] Stale saves retain the local draft, show the latest disk version, allow an editable merge, and still require a revision-protected final save.
- [x] Desktop Monaco, Diff Editor, settings, native fallback, and conflict recovery are keyboard operable and have no serious axe violations or unexplained focus trap.
- [x] Production editor and worker assets load from the Hono-served application origin, and final bundle-size evidence is recorded without suppressing warnings.
- [x] No full IDE, terminal, code execution, VS Code extension host, LSP server, database migration, new workspace permission, or host absolute path is introduced.
- [x] Focused tests, `npm run ci`, SQLite E2E, PostgreSQL E2E when available, and the production Docker build pass with recorded evidence.
- [x] `README.md` accurately describes capabilities, fallbacks, keyboard behavior, and semantic-intelligence limits.
- [x] The final diff contains only the dependency, Web editor, tests, documentation, and configuration changes required by this plan.
- [x] The completed plan is archived only after every applicable item above has evidence or an explicitly accepted blocker.
