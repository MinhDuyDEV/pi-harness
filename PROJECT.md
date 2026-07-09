# Project Map

A lean index of where things live in this repo. Maintained by the agent.

## Folders (top-level)

- `bin/` — CLI entry points
- `scripts/` — npm scripts (validate-skills, run-extension-tests, etc.)
- `src/` — application source (if present)
- `tests/` — test suites (if present)
- `docs/` — committed documentation (if present)
- `templates/` — file templates
- `themes/` — UI themes
- `prompts/` — prompt definitions
- `skills/` — agent skill definitions (78 skills)
- `agents/` — agent role definitions (opencode-compatible)
- `sessions/` — session state

## `.pi/` (project-level agent config)

- `.pi/agents/` — agent role definitions
- `.pi/extensions/` — 32 extensions (memory, deepseek, srcwalk, safety, etc.)
- `.pi/integration/` — integration code (checkpoint, budget, etc.)
- `.pi/checkpoint/` — checkpoint module
- `.pi/artifacts/` — ephemeral working state (ADRs, PROGRESS, TODO from cleanup)
- `.pi/cli/` — CLI plumbing
- `.pi/skills/` — agent skills (~78 skills)
- `.pi/prompts/` — prompt templates
- `.pi/templates/` — file templates
- `.pi/themes/` — UI themes
- `.pi/shell-hooks/` — shell hook scripts
- `.pi/sessions/` — session state
- `.pi/cache/` — caches
- `.pi/npm/` — npm package management
- `.pi/git/` — git automation
- `.pi/fff/` — fast-file-find cache
- `.pi/pi-pretty/` — pretty-printer module

## Key Files (top-level)

- `package.json` — npm metadata, scripts (start, test, validate, typecheck)
- `tsconfig.json` — TypeScript config
- `README.md` — top-level readme
- `LICENSE` — MIT
- `AGENTS.md` (in `.pi/`) — agent behavior kernel
- `DESIGN.md` (in `.pi/`) — design doc
- `SYSTEM.md` (in `.pi/`) — system prompt
- `APPEND_SYSTEM.md` (in `.pi/`) — system prompt append

## Notable Sub-Extensions

- `.pi/extensions/memory/` — FTS5-backed memory (after ADR-001 cleanup, 2,438 lines)
- `.pi/extensions/deepseek/` — DeepSeek model integration
- `.pi/extensions/srcwalk/` — code analysis (read, search, callers, callees)
- `.pi/extensions/safety/` — safety hooks
- `.pi/extensions/checkpoint/` — checkpoint manager
- `.pi/extensions/integration/budget.ts` — token budget tracker
- `.pi/extensions/task/` — long-running subagent orchestration via the `task` tool

## Notes

- All extensions live under `.pi/extensions/<name>/` with an `index.ts` entry point
- Agent definitions are in `.pi/agents/*.md` (opencode-compatible format)
- `.pi/artifacts/` is gitignored (ephemeral state)
- `.pi/docs/` would be the committed location for ADRs (currently empty)
- Run `npm run validate` to check skills config
- Run `npm run typecheck` to verify TypeScript
- See [ADR-001](./.pi/artifacts/memory-extension-cleanup/ADR-001-memory-extension-cleanup.md) for the recent memory extension cleanup
