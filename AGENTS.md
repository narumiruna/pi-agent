# Repository Guidelines

## Project Structure

- Treat `src/server/` as the Hono backend, `src/web/` as the React client, and `src/shared/` as code shared across both runtimes.
- Keep tests under `tests/server/` and `tests/web/`, with reusable data in `tests/fixtures/`.
- Do not hand-edit generated output in `dist/` or `*.tsbuildinfo` files.
- Preserve Pi's native sessions, settings, providers, tools, prompts, skills, extensions, and package behavior instead of creating parallel abstractions.
- Set `PI_CODING_AGENT_DIR` before using native `SessionManager` defaults so conversation discovery stays inside the configured agent directory.
- Provide a concrete Pi `Theme` such as `createHeadlessTheme()` when binding Web extension UI; terminal themes are not rendered or executed in the browser.

## Third-Party Dependencies

- Before using any third-party JavaScript or TypeScript library or package, first inspect its installed package under `node_modules` in detail, including the available README or documentation, type declarations, relevant implementation, exports, and examples.
- Verify APIs and behavior against the installed version in `node_modules`; do not rely only on memory or documentation for another version.
- Never modify files under `node_modules`; change project code or dependency versions instead.

## Commands

- Use Node.js 24 or newer and run commands from the repository root.
- Install a clean dependency tree with `npm ci`.
- Run development servers with `npm run dev` after configuring the local environment described in `README.md`.
- Run formatting and lint checks with `npm run check`.
- Run tests once with `npm test`.
- Build server and Web output with `npm run build`.
- Run the normal pre-commit verification gate with `npm run ci`.
- Run `docker build -t pi-agent:local .` when Docker or production-runtime behavior changes.

## Code and Tests

- Keep TypeScript imports static and top-level.
- Let Biome enforce formatting and lint rules from `biome.json`.
- Prefer existing Pi core APIs and small KISS/YAGNI changes over custom framework layers.
- Add or update Vitest coverage for behavior changes, and place tests in the matching server or Web test area.
- Set `TEST_POSTGRES_URL` when validating PostgreSQL storage contracts; CI supplies PostgreSQL automatically.

## Security and Git

- Use `.env.example` as the configuration reference, and never commit credentials or authentication tokens.
- Treat Pi packages, extensions, MCP servers, and enabled write or shell tools as trusted-code security boundaries.
- Keep commits focused and follow the repository's Conventional Commit style, such as `fix(auth): ...` or `feat(settings): ...`.
