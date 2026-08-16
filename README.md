# Pi Agent

Pi Agent is a small, single-owner Web interface for the [Pi coding agent](https://github.com/earendil-works/pi).

It keeps Pi's native sessions, settings, prompts, skills, extensions, packages, model providers, and tools instead of rebuilding their behavior.

The application uses TypeScript, Hono, React, Radix UI, SQLite or PostgreSQL, and Docker.

## Scope

Pi Agent provides Web chat, native steering and follow-up queues, Pi session management, Pocket ID-compatible OIDC, prompt and package management, MCP tools, and one `HEARTBEAT.md` routine.

It does not provide multiple users, messaging channels, workflows, cron jobs, a Web terminal, or horizontal scaling.

Run one application process for each Pi agent directory.

## Quick start

Copy the environment template and configure OIDC.

```sh
cp .env.example .env
docker compose up --build -d
```

Open the configured `APP_ORIGIN` after the health check becomes ready.

Use the PostgreSQL variant when required.

```sh
docker compose -f compose.yaml -f compose.postgres.yaml up --build -d
```

For a local-only evaluation without authentication, explicitly set `AUTH_MODE=disabled` and do not expose the port beyond a trusted machine.

```sh
APP_ORIGIN=http://localhost:3000 AUTH_MODE=disabled docker compose up --build
```

Missing OIDC settings fail closed unless `AUTH_MODE=disabled` is explicit.

## Pocket ID

Create an OIDC client in Pocket ID with this callback URL.

```text
https://agent.example.com/auth/callback
```

Set `APP_ORIGIN` to the public HTTPS origin without a path.

Set `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` from the Pocket ID client.

Restrict the Pocket ID client to the intended user or administrator group before exposing a new Pi Agent instance.

The first identity that completes a cryptographically verified OIDC login becomes the permanent Pi Agent administrator.

Later logins must have the same OIDC issuer and `sub` claim, so username and email changes do not affect ownership.

The application stores ownership and a hash of each 24-hour application session token, and it does not retain OIDC tokens.

To deliberately reset ownership, stop Pi Agent, delete the singleton row from `app_owner` and all rows from `web_sessions`, then restart and sign in with the new administrator.

For SQLite, run this against the mounted `/app/data/app.db` with a SQLite client.

For PostgreSQL, run `TRUNCATE web_sessions, app_owner;` during a maintenance window.

Run behind an HTTPS reverse proxy because secure authentication cookies require HTTPS outside localhost.

## Pi agent directory

`/app/.pi/agent` is the complete writable Pi runtime directory.

It contains native Pi files such as `settings.json`, `auth.json`, `models.json`, prompts, skills, extensions, packages, and JSONL sessions.

The Compose default uses a dedicated named volume.

A bind mount can supply an existing dedicated directory.

```sh
docker run --rm -p 3000:3000 \
  -e APP_ORIGIN=http://localhost:3000 \
  -e AUTH_MODE=disabled \
  -v "$(pwd)/data/pi/agent:/app/.pi/agent" \
  -v "$(pwd)/data/app:/app/data" \
  pi-agent:local
```

You may bind mount the host `~/.pi/agent`, but the container can then read and modify host credentials, sessions, packages, and executable extensions.

Prefer a dedicated `./data/pi/agent` directory unless full host sharing is intentional.

Packages installed on macOS or another CPU architecture may not run inside the Linux image and may need reinstalling through the Web package manager.

The image runs as UID and GID `10001`, so Linux bind-mounted directories must be writable by that identity.

```sh
sudo chown -R 10001:10001 ./data/pi/agent ./data/app
```

## Models and providers

Open Settings and select **Add access**.

Choose **Subscriptions** for provider sign-in, or choose **API keys** to save a key through Pi's native login flow.

For OpenAI Codex, a ChatGPT Plus or Pro subscription is required.

Choose **Device code login** for Docker and remote servers, copy the displayed code, select **Open OpenAI**, and finish authorization in the OpenAI page.

Device-code status remains in the authentication dialog and can be restored after a browser refresh while the server process and login remain active.

Browser login remains available, but its localhost callback may not reach the container.

If that callback fails, paste the final redirect URL or authorization code into the authentication dialog.

Cancelling sign-in stops the pending Pi authentication flow without removing a previously valid credential.

Use **Reconnect** beside a stored subscription when its token is no longer valid or you need to change accounts.

Provider credentials are saved by Pi in `/app/.pi/agent/auth.json`, so the agent directory must be writable and persistent.

After adding access, select **Change model**, preview an available model, and confirm **Use this model**.

The selected model is applied to both Web chat and heartbeat, while the thinking menu only shows levels supported by that model.

Settings also controls Pi's native steering and follow-up delivery modes, automatic compaction, automatic retry, and the active tools allowed by the server configuration.

For non-interactive deployment, you may instead mount an existing `auth.json` or pass a provider environment variable through Compose, such as `ANTHROPIC_API_KEY`.

Settings identifies environment and `models.json` credentials as externally managed and does not offer to remove them.

Only credentials stored in Pi's `auth.json` can be disconnected from Settings, and removal requires confirmation.

Custom providers and models use `/app/.pi/agent/models.json` in Pi's native format.

After subscription sign-in succeeds, choose **Choose a model** to review the available models.

Pi Agent never switches the current model automatically after authentication.

## Data and database

`/app/data/app.db` stores Web login sessions and heartbeat run summaries when `DATABASE_URL` is absent.

Set a `postgresql://` `DATABASE_URL` to use PostgreSQL for that Web state.

Pi conversations remain native JSONL files under `/app/.pi/agent` and are the sole conversation source of truth in both database modes.

Persisted list entries, inactive reads, and switches resolve opaque native IDs against current `SessionManager` records, while absolute JSONL paths stay on the server.

Neither SQLite nor PostgreSQL mirrors normal conversation entries, transcripts, or JSONL content.

The conversation details panel shows native session statistics and tree entries, and it uses Pi APIs for navigation, fork, clone, manual compaction, HTML or JSONL export, and JSONL import.

Imported sessions are limited to 5 MB, are validated as Pi JSONL, use the configured workspace instead of the source machine path, and reject a duplicate session ID.

Destructive session operations are rejected while chat or heartbeat work is active.

Back up `/app/.pi/agent` and `/app/data` together for SQLite deployments.

Back up `/app/.pi/agent` and PostgreSQL at a consistent maintenance point for PostgreSQL deployments.

## Navigation and accessibility

The desktop sidebar and 390px mobile drawer share one authenticated destination model.

Primary destinations use native keyboard controls, a localized navigation landmark, `aria-current` state, and visible focus indicators.

The mobile drawer traps focus while open and restores focus to its trigger after a destination is selected or the drawer is dismissed.

The interface honors `prefers-reduced-motion` by suppressing animation and transition timing without hiding state changes.

Current destinations use canonical paths at `/chats`, `/files`, `/prompts`, `/heartbeat`, `/library`, and `/settings`.

The Chats destination retains the Pi-backed conversation list, active selection, and New conversation action.

Conversation discovery follows Pi’s resume selector with fuzzy terms, quoted exact phrases, `re:<pattern>` regular expressions, All or Named-only filtering, and Threaded, Recent, or Fuzzy sorting.

Search runs over native session metadata and user/assistant text on the server; message text, cwd, JSONL paths, parent paths, and scores never enter the list response.

Each conversation row opens one management dialog for native session rename and confirmed inactive-session deletion; the active session must be switched first and cannot be deleted.

Conversation details retain Pi’s native tree navigation, fork, clone, compaction, JSONL/HTML export, and validated JSONL import lifecycle without duplicating session state.

Management and runtime replacement are rejected while an agent run is active, and reconnecting event streams reconcile the authoritative run, queue, draft, transcript, and list state.

Direct loads, reloads, Back, and Forward restore those pages, while root, unknown, malformed, and not-yet-enabled routes replace safely to `/chats`.

A validated current path is carried through signed OIDC state so direct bookmarks survive sign-in without enabling open redirects.

The production server serves the Web shell only for HTML navigation and never as a fallback for `/api`, `/auth`, `/health`, `/assets`, or non-HTML requests.

## Workspace and tools

`/workspace` is the fixed working directory for Pi tools and the Files page.

The Files page browses directories lazily and can preview, create, edit, rename, download, and delete regular files.

Text preview and editing are limited to valid UTF-8 files of 1 MB or less.

Desktop editing uses a self-hosted Monaco code editor with extension-based syntax highlighting, local language workers, light and dark themes, and no external CDN dependency.

This editor is not a full IDE and does not add project language servers, code execution, terminals, or VS Code extensions.

Editor settings for font size, tab size, wrapping, minimap, whitespace, and editor mode are stored only in the current browser.

Small screens and Monaco startup failures use a native plain-text editor without changing the loaded draft.

Ctrl/Cmd+S saves, Ctrl/Cmd+F finds in Monaco, and the Tab focus control lets keyboard users leave the editor.

Binary and larger files expose metadata and a download action, while downloads are streamed and limited to 100 MB.

All Files APIs accept and return slash-separated workspace-relative paths and never return host absolute paths.

The server resolves the workspace to a canonical real path, walks each existing target segment without following symlinks, resolves the final target, and checks containment before use.

Create and rename destinations require a canonical contained parent and a validated basename.

Files skips symlinks, `.agents`, `.git`, `.hg`, `.svn`, `.local`, `.pi`, `.ssh`, `dist`, `node_modules`, credential-like files, and configured agent or application data directories.

Writes use temporary files and atomic replacement, and updates, renames, and deletes require an opaque revision so an external change produces a conflict instead of a silent overwrite.

A stale save fetches the latest file into a review dialog with a read-only disk version and an editable local draft.

Cancel keeps the draft, **Use disk version** discards it, and **Apply merged draft** returns the edited result to the main editor without saving automatically.

The next save uses the refreshed revision, and another external change opens a new review instead of overwriting it.

If the refreshed file is missing, binary, too large, or unreadable, Files keeps the local draft and reports why review is unavailable.

Create and rename never replace an existing destination.

Rename and delete are destructive, so keep workspace files in Git or an external backup when recovery matters.

A trusted local process can still race filesystem checks, so Pi tools, extensions, packages, and other processes with workspace access remain part of the existing trusted-code boundary.

The chat composer offers slash-command completion and bounded `@file` search inside this directory using the same visibility policy as Files.

The authenticated owner can edit through Files even when Pi's `write` tool is disabled because `AGENT_TOOLS` controls model-generated tool calls, not owner UI actions.

Filesystem permissions remain authoritative, so use a read-only mount to make Files preview-only.

`AGENT_TOOLS` defaults to `read,grep,find,ls,write`, so Pi can create or completely rewrite files in container-writable locations.

Mount a repository read-write only when it forms an acceptable security boundary.

```yaml
services:
  agent:
    volumes:
      - ./project:/workspace
```

For a read-only workspace, mount it with `:ro` and remove `write` explicitly.

```env
AGENT_TOOLS=read,grep,find,ls
```

Add `edit` for targeted changes or `bash` for shell access only when their broader permissions are acceptable.

```env
AGENT_TOOLS=read,grep,find,ls,write,edit,bash
```

OIDC authenticates the owner but does not sandbox Pi, extensions, skills, MCP servers, packages, or model-generated tool calls.

Web metadata responses omit the OIDC subject, native runtime diagnostics, package sources, installed package paths, and terminal control sequences.

Package list entries use opaque IDs and bounded display names, and update or removal resolves those IDs against Pi's current native package settings.

Explicit owner-requested content such as transcripts, documents, redacted MCP configuration, workspace files, tool output, and session exports remains available through its dedicated endpoint.

Resource metadata preserves Pi's native `scope` (`user`, `project`, or `temporary`) separately from `origin` (`top-level` or `package`).

The Web renders those path-free fields directly and does not infer ownership from resource names or filesystem paths.

Project-local Pi settings, prompts, skills, packages, and extensions remain disabled until Pi's native project trust is effective.

Startup, every session rebuild, and every general resource reload first refresh native settings and then honor the nearest saved `trust.json` decision and the global non-interactive `defaultProjectTrust`; `ask`, `never`, and trust-store read failures remain untrusted.

The Settings status reports the effective runtime state, so an external `trust.json` change appears only when one of those synchronized resource-discovery boundaries applies it, and loaded resources remain disableable after their source files are removed.

The authenticated Settings page requires an executable-code acknowledgement before enabling project trust, including proactively before the first project resource is created, waits for the agent to become idle, reloads chat and heartbeat through Pi, and persists the decision in Pi's native trust store.

Disabling trust reloads and unloads project resources.

The generic Files API excludes `.agents` and `.pi`, so it cannot bypass this resource boundary.

Library package and MCP controls plus Settings project trust display one persistent trusted-code warning that covers packages, skills, extensions, and MCP servers.

Future Skills and Extensions management surfaces must reuse that warning and retain any stronger acknowledgement gate.

Resource mutations persist through Pi-native files, settings, or package APIs before calling `PiService.reload()`.

That adapter waits for active work and invokes Pi's `AgentSession.reload()` lifecycle for chat and heartbeat sessions.

Resource code must never patch loader results, prompt arrays, command maps, skill lists, or extension lists directly.

Project trust controls input loading and is not a sandbox for Pi tools, extensions, packages, skills, or model output.

## Prompts, skills, and extensions

The Prompts page edits global `SYSTEM.md` and `APPEND_SYSTEM.md` through the existing resource API.

Its template inventory comes directly from Pi’s active resource loader, including global user, trusted project, package, settings-added, and temporary prompt templates after native precedence and deduplication.

The Web receives opaque prompt IDs, Pi’s scope/origin provenance, prompt-authored descriptions and argument hints, sanitized source labels, and logical paths such as `~/.pi/agent/prompts/review.md`, `.pi/prompts/review.md`, or a package-relative path; native absolute paths, raw package sources, and installation roots remain server-only.

Direct, non-symlink user files in Pi’s canonical global prompt directory and effectively trusted project files in the canonical project prompt directory are editable through opaque IDs.

Package-origin, temporary, settings-added files outside those canonical directories, nested files, symlinked files, and untrusted project prompts are read-only.

New templates are created only in Pi’s canonical global or trusted-project prompt directories, reject existing or higher-precedence native winners, and never overwrite an existing file.

The inventory shows path-safe diagnostics for invalid command names, YAML frontmatter, the one-megabyte UTF-8 content limit, and Pi-native name collisions.

Invalid prompt writes are rejected before persistence, while collision warnings preserve Pi’s native first-winner precedence.

Prompt mutations refresh trust and discovery under Pi’s maintenance lease, use atomic persistence, and reload both native sessions afterward, so `/command` discovery refreshes without a parallel prompt store or command cache.

Chat autocomplete uses Pi’s resolved extension invocation names plus native prompt argument hints and safe source/provenance labels.

The Skills page lists only Pi’s active `ResourceLoader.getSkills()` snapshot, including native validation warnings and scope/origin provenance for global, trusted-project, package, settings-added, and temporary skills.

Skill IDs are opaque and entry locations are logical paths; the browser never receives native absolute paths or installation roots.

The read-only viewer exposes a directory skill’s regular `SKILL.md`, references, scripts, and assets within bounded file/depth/size limits, while a direct Markdown skill exposes only its own entry file.

UTF-8 text can be viewed as plain text; binary, oversized, symlinked, hard-linked, and unavailable assets expose metadata only and are never executed.

Library retains package and MCP controls during the remaining resource migration.

Skills and extensions are installed as native Pi packages from npm, git, or a relative or absolute path inside the container.

Pi packages and extensions execute arbitrary code with the application user's container permissions.

Review every source before acknowledging the installation warning.

Web extensions can use tools, events, commands, `select`, `confirm`, `input`, `editor`, typed notifications, keyed status messages, string widgets, document titles, working labels, tool expansion state, and editor prefill.

Extension UI text has terminal control sequences removed and is bounded by count, size, and update-rate limits before it reaches the browser.

TUI component factories from `ctx.ui.custom()`, component widgets, custom headers, custom footers, custom editors, raw terminal input, terminal themes, and renderer callbacks are not rendered or executed in the browser.

See [`docs/research/pi-tui-web-compatibility.md`](docs/research/pi-tui-web-compatibility.md) for the compatibility analysis and design boundary.

## MCP

MCP configuration is stored at `/app/.pi/agent/mcp.json`.

The format supports stdio and Streamable HTTP servers.

See [`examples/mcp.json`](examples/mcp.json) for both forms.

Stdio commands use an executable and argument array without a shell.

Legacy MCP SSE transport is not supported.

Only MCP tools are bridged in the first release, and their Pi names use `mcp__<server>__<tool>`.

The API masks environment and header values after saving them.

MCP servers execute code or receive data with the application's privileges, so treat them as trusted dependencies.

## Heartbeat

`/app/.pi/agent/HEARTBEAT.md` is the only proactive routine.

With the default `write` tool, ask Pi to write this absolute path because a relative `HEARTBEAT.md` would be created under `/workspace` and would not control the scheduler.

```markdown
---
enabled: true
every: 30m
---

Review anything that needs my attention.
If nothing needs attention, reply exactly HEARTBEAT_OK.
```

The interval accepts integer minutes, hours, or days from `1m` through `7d`.

Heartbeat uses a dedicated persistent Pi JSONL session and never writes into normal conversations.

It waits while chat is active, never overlaps, never retries automatically, and performs at most one catch-up run after restart.

A response exactly equal to `HEARTBEAT_OK` is a quiet success.

See [`examples/HEARTBEAT.md`](examples/HEARTBEAT.md) for a complete example.

## Development

Node.js 24 or newer is required.

```sh
npm install
mkdir -p .local/pi-agent .local/data
APP_ORIGIN=http://localhost:5173 \
HOST=127.0.0.1 \
AUTH_MODE=disabled \
PI_CODING_AGENT_DIR="$PWD/.local/pi-agent" \
DATA_DIR="$PWD/.local/data" \
WORKSPACE="$PWD" \
npm run dev
```

This development command is intentionally unauthenticated and should only listen on a trusted local machine.

Use real OIDC variables instead when testing authentication.

Run the complete verification gate before committing.

```sh
npm run ci
```

The test suite runs PostgreSQL storage contracts when `TEST_POSTGRES_URL` is set.

```sh
TEST_POSTGRES_URL=postgresql://pi-agent:password@localhost:5432/pi-agent npm test
```

The Phase 0 server-boundary acceptance matrix is pinned to matching server suites.

- `tests/server/http-auth.test.ts` covers unauthenticated API paths, cross-origin mutations, the global request limit, and the workspace payload limit.
- `tests/server/workspace.test.ts` covers traversal rejection, symlink escape, stale update and delete revisions, and concurrent same-revision writes.
- `tests/server/resources.test.ts` covers prompt traversal, symlink replacement, and the resource document byte limit.
- `tests/server/agent.test.ts` covers active-run conflicts for every operation guarded by `PiService.requireIdle()`.

Install Chromium once, then run the production-build E2E suite with isolated SQLite data.

```sh
npx playwright install chromium
just e2e
```

The E2E harness uses deterministic local OIDC and OpenAI-compatible mocks, writes only under `.local/e2e/`, and never reads `.env` or `~/.pi/agent`.

Use a fresh dedicated PostgreSQL database whose name contains `e2e` for parity testing because the harness drops its application tables before startup.

```sh
E2E_DATABASE_URL=postgresql://pi-agent:password@localhost:5432/pi_agent_e2e \
  just e2e-postgres
```

Override `E2E_APP_PORT` and `E2E_MOCK_PORT` when the default ports `39110` and `39111` are unavailable.

Failure traces, screenshots, videos, and the HTML report are written under `.local/e2e/`.

## Operational limits

Only one process may write a given `/app/.pi/agent` directory, and a runtime lock rejects a second process.

Only one chat or heartbeat model run executes at a time.

Database migrations run during startup, and readiness stays false when initialization fails.

Graceful shutdown stops HTTP traffic, interactions, heartbeat, Pi sessions, MCP clients, storage, and the runtime lock.
