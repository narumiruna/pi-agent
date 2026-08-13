## GOTCHA

- Set `PI_CODING_AGENT_DIR` before using native `SessionManager` defaults so conversation discovery stays inside the configured agent directory.
- Pi's extension Web bridge still requires a concrete `Theme` even when no terminal theme files are installed.

## TASTE

- Keep imports static and top-level; never use inline or dynamic imports.
- Prefer Pi core packages and minimal KISS/YAGNI solutions over parallel custom abstractions.
