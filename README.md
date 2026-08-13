# Pi Agent

Pi Agent is a small, single-owner Web interface for the [Pi coding agent](https://github.com/earendil-works/pi).

It keeps Pi's native sessions, settings, prompts, skills, extensions, packages, model providers, and tools instead of rebuilding their behavior.

The application uses TypeScript, Hono, React, Radix UI, SQLite or PostgreSQL, and Docker.

## Scope

Pi Agent provides Web chat, Pocket ID-compatible OIDC, prompt and package management, MCP tools, and one `HEARTBEAT.md` routine.

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

Authorize the single owner with `OIDC_OWNER_SUB`, `OIDC_OWNER_EMAIL`, or both.

When both owner values are configured, both claims must match.

Email authorization also requires Pocket ID to return `email_verified: true`.

The application stores a hash of its own 24-hour session token and does not retain OIDC tokens.

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

## Data and database

`/app/data/app.db` stores Web login sessions and heartbeat run summaries when `DATABASE_URL` is absent.

Set a `postgresql://` `DATABASE_URL` to use PostgreSQL for that Web state.

Pi conversations remain native JSONL files under `/app/.pi/agent` in both database modes.

Back up `/app/.pi/agent` and `/app/data` together for SQLite deployments.

Back up `/app/.pi/agent` and PostgreSQL at a consistent maintenance point for PostgreSQL deployments.

## Workspace and tools

`/workspace` is the fixed working directory for Pi tools.

Mount a repository read-only for the default tool set.

```yaml
services:
  agent:
    volumes:
      - ./project:/workspace:ro
```

`AGENT_TOOLS` defaults to `read,grep,find,ls`.

Explicitly add `bash`, `edit`, or `write` only when the container and workspace mounts form an acceptable security boundary.

```env
AGENT_TOOLS=read,grep,find,ls,bash,edit,write
```

OIDC authenticates the owner but does not sandbox Pi, extensions, skills, MCP servers, packages, or model-generated tool calls.

## Prompts, skills, and extensions

The Library page edits `SYSTEM.md`, `APPEND_SYSTEM.md`, and files under `prompts/` with atomic writes.

Skills and extensions are installed as native Pi packages from npm, git, or a relative or absolute path inside the container.

Pi packages and extensions execute arbitrary code with the application user's container permissions.

Review every source before acknowledging the installation warning.

TUI-specific extension components are not rendered in the browser.

Web extensions can use tools, events, commands, `select`, `confirm`, `input`, `editor`, notifications, and status messages.

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

## Operational limits

Only one process may write a given `/app/.pi/agent` directory, and a runtime lock rejects a second process.

Only one chat or heartbeat model run executes at a time.

Database migrations run during startup, and readiness stays false when initialization fails.

Graceful shutdown stops HTTP traffic, interactions, heartbeat, Pi sessions, MCP clients, storage, and the runtime lock.
