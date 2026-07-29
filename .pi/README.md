# `.pi/` harness resources

This directory contains project-local Pi resources and the resources published by the `pi-harness` Pi package.

## Published manifest resources

Pi package discovery loads:

- `extensions/`
- `skills/`
- `prompts/`
- `themes/`

The `.pi/APPEND_SYSTEM.md` supplement is shipped as initializer input but is not auto-injected by package discovery. `pi-harness-init` materializes its sentinel-managed region into a consumer's project-local `.pi/APPEND_SYSTEM.md` while preserving consumer prose. The package kernel remains additive: no extension injects this policy implicitly.

## Template roots

The repository has two intentional template roots with different owners:

- `../templates/` (repository path `templates/`) contains package initializer inputs. `pi-harness-init` copies or merges these portable project files into consumer repositories; Pi does not discover this directory as runtime prompt content.
- `.pi/templates/` contains harness workflow state templates used by local workflow tooling. They are package resources for the workflow contract, not initializer inputs and not Pi prompt templates.

Keep initializer delivery changes in `templates/`; keep workflow record schemas and examples in `.pi/templates/`. Do not mirror files between the roots.

## Source-checkout profile

These resources are active when this repository is used directly but are not automatically applied by package installation:

- `settings.json` — pinned project packages and extension settings.
- `agents/` — seven canonical profiles for `@minhduydev/pi-subagents`. Each intentionally pins a reproducible model seat; consumers may customize these files, and unavailable seats fail preflight instead of silently switching models.
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
