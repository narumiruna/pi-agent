# Show available commands.
default:
    @just --list

# Install dependencies.
install:
    npm install

# Build the TypeScript project.
build:
    npm run build

# Run the development server and Vite client.
dev:
    npm run dev

# Build and run the application with the current environment.
run: build
    npm start

# Run tests once.
test:
    npm test

# Check formatting and lint rules.
check:
    npm run check

# Apply Biome formatting and safe lint fixes.
fix:
    npm exec -- biome check --write .

# Run the same checks used by CI and the pre-commit hook.
ci:
    npm run ci

# Build the container image.
docker-build:
    docker build -t pi-agent:local .

# Start the SQLite Compose stack using .env.
compose-up:
    docker compose up -d --build

# Stop the SQLite Compose stack.
compose-down:
    docker compose down

# Show recent SQLite Compose logs without following.
compose-logs:
    docker compose logs --tail=200

# Start the PostgreSQL Compose stack using .env.
postgres-up:
    docker compose -f compose.yaml -f compose.postgres.yaml up -d --build

# Stop the PostgreSQL Compose stack.
postgres-down:
    docker compose -f compose.yaml -f compose.postgres.yaml down

# Build and smoke-test the SQLite container stack.
smoke:
    #!/usr/bin/env bash
    set -euo pipefail
    export APP_ORIGIN=http://localhost:3100 AUTH_MODE=disabled PORT=3100
    trap 'docker compose -p pi-agent-smoke down -v >/dev/null 2>&1 || true' EXIT
    docker compose -p pi-agent-smoke up -d --build
    for _ in $(seq 1 60); do docker compose -p pi-agent-smoke exec -T agent node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && exit 0; sleep 1; done
    exit 1

# Build and smoke-test the PostgreSQL container stack.
postgres-smoke:
    #!/usr/bin/env bash
    set -euo pipefail
    export APP_ORIGIN=http://localhost:3101 AUTH_MODE=disabled PORT=3101 POSTGRES_PASSWORD=smoke-password
    trap 'docker compose -p pi-agent-postgres-smoke -f compose.yaml -f compose.postgres.yaml down -v >/dev/null 2>&1 || true' EXIT
    docker compose -p pi-agent-postgres-smoke -f compose.yaml -f compose.postgres.yaml up -d --build
    for _ in $(seq 1 60); do docker compose -p pi-agent-postgres-smoke -f compose.yaml -f compose.postgres.yaml exec -T agent node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && exit 0; sleep 1; done
    exit 1
