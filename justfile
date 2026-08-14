# Show available commands.
default:
    @just --list

# Install exact dependencies.
install:
    npm ci

# Start the normal development servers.
dev:
    npm run dev

# Start locally with this repository as Pi's writable workspace.
dogfood:
    APP_ORIGIN="${APP_ORIGIN:-http://localhost:3100}" \
        HOST=127.0.0.1 \
        AUTH_MODE=disabled \
        PI_CODING_AGENT_DIR="$PWD/.local/pi-agent" \
        DATA_DIR="$PWD/.local/data" \
        WORKSPACE="$PWD" \
        AGENT_TOOLS=read,grep,find,ls,write,edit,bash \
        npx concurrently \
            "tsx watch src/server/index.ts" \
            "vite --host 0.0.0.0 --port 3100 --strictPort"

# Run unit and integration tests.
test:
    npm test

# Run the complete verification gate.
ci:
    npm run ci

# Run browser tests with SQLite.
e2e:
    npm run test:e2e

# Run browser tests with PostgreSQL.
e2e-postgres:
    : "${E2E_DATABASE_URL:?Set E2E_DATABASE_URL}"; npm run test:e2e

# Build and start the SQLite stack.
up:
    docker compose up -d --build --remove-orphans

# Stop the SQLite stack.
down:
    docker compose down --remove-orphans

# Show recent SQLite logs.
logs:
    docker compose logs --tail=200

# Build and start the PostgreSQL stack.
postgres-up:
    docker compose -f compose.yaml -f compose.postgres.yaml up -d --build --remove-orphans

# Stop the PostgreSQL stack.
postgres-down:
    docker compose -f compose.yaml -f compose.postgres.yaml down --remove-orphans
