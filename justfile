# Show available commands.
default:
    @just --list

# Install dependencies.
install:
    npm install

# Build the TypeScript project.
build:
    npm run build

# Build and run the application.
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
