# `.pi/` harness resources

This directory contains project-local Pi resources and the resources published by the `pi-harness` Pi package.

## Published manifest resources

Pi package discovery loads:

- `extensions/`
- `skills/`
- `prompts/`
- `themes/`

The `.pi/APPEND_SYSTEM.md` supplement is the author's local runtime policy for developing this repo. It is **not shipped** and **not injected** into consumers — a consuming repository owns its own `.pi/APPEND_SYSTEM.md`. The package kernel is additive: the `harness-policy` injection extension was removed; delegation uses `@minhduydev/pi-subagents`, an additive runtime that never injects policy into a consumer's system prompt.

## Source-checkout profile

These resources are active when this repository is used directly but are not automatically applied by package installation:

- `settings.json` — pinned project packages and extension settings.
- `agents/` — project agent profiles (`explore`, `general`, `reviewer`, `scout`) for the `@minhduydev/pi-subagents` delegation runtime. The `model:` frontmatter is omitted so agents inherit your `defaultModel`; set `model:` to a specific provider/model only if you want a per-agent override.
- `APPEND_SYSTEM.md` — project-level runtime supplement; extensions, skills, and prompts layer below it without duplicating it.
- `../AGENTS.md` — package maintenance instructions loaded by Pi project-context discovery.

Detailed workflows belong in `skills/`; lifecycle orchestration belongs in `prompts/`; universal runtime rules stay in `APPEND_SYSTEM.md`. `.pi/AGENTS.md` is intentionally absent because it is not a supported project-context location.

The Full `workflow-state` extension validates foundation,
reconciliation, and fourteen-section handoff records through the shared
`@minhduydev/pi-core/workflow` contract. See `docs/workflow-state.md`.

## Auto-safe learning profile

The harness pins `@minhduydev/pi-learning` and enables its `auto-safe` profile in `settings.json`. The learning coordinator translates verified subagent proof, TODO lifecycle, DCP, and review signals into bounded versioned observations. Only digest-bound low-risk observations may activate automatically; policy-bearing files and curated `MEMORY.md` still require explicit promotion. Learning context is bounded, provenance-labelled, and fail-open.

## Local runtime state

- `.pi/artifacts/`
- `.pi/MEMORY.md`
- `.pi/npm/`

These paths are local state, ignored by git, and forbidden from the npm payload.
