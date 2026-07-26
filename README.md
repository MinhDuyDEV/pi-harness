# pi-harness

`pi-harness` is a reusable Pi Coding Agent harness: curated extensions, skills, prompt templates, themes, runtime policy, and a tested source-checkout profile.

## Requirements

- Node.js `>=22.19.0`
- npm `>=11.12.1`
- Pi Coding Agent `0.81.1` (tested against Pi 0.81.1; the package uses the active host's Pi packages through peer dependencies)

## Install as a Pi package

```bash
pi install npm:@minhduydev/pi-harness
```

Restart Pi after installation. Pi discovers the package manifest resources:

- `.pi/extensions/`
- `.pi/skills/`
- `.pi/prompts/`
- `.pi/themes/`

Pi package discovery does **not** automatically apply this repository's root `AGENTS.md`, `.pi/settings.json`, or `.pi/agents/` directory. Those files configure and document the source-checkout profile:

- Run `/init` in a consuming repository to create or update that repository's own `AGENTS.md` from observed facts.
- Delegated task agents come from `@minhduydev/pi-subagents`, which `.pi/settings.json` already pins.
- Copy or adapt `.pi/agents/` only when project-specific pi-subagents overrides are wanted; otherwise use the bundled agents.
- Never copy provider credentials, personal model defaults, caches, `.pi/MEMORY.md`, or `.pi/artifacts/`.

## Source-checkout profile

When this repository is used directly, `.pi/settings.json` provides a pinned project profile for task delegation, diagnostics, source lookup, and web/documentation tools. Optional packages remain optional at runtime: prompts and policies must degrade explicitly when a tool is unavailable.

Context ownership is intentionally layered:

- `AGENTS.md` — maintenance rules for this package checkout.
- `.pi/APPEND_SYSTEM.md` — concise, repository-agnostic runtime policy.
- `.pi/skills/*/SKILL.md` — detailed workflows loaded on demand.
- `.pi/prompts/*.md` — user-invoked lifecycle orchestration.
- `.pi/agents/*.md` — role-specific pi-subagents contracts loaded only in configured checkouts.

`.pi/AGENTS.md` is intentionally absent because Pi discovers project context from root or nested `AGENTS.md` files, not from that duplicate location.

## Prompt lifecycle

- `/init` — inspect a target repository and create or safely merge project guidance.
- `/create` — specify and implement a change.
- `/fix` — diagnose and fix a defect from root cause.
- `/plan` — write an executable plan without implementation.
- `/research` — gather decision-ready evidence.
- `/verify` — run behavior, quality, and scope verification.
- `/ship` — perform final review and repository-defined gates.

Prompt frontmatter uses only Pi-supported fields. Prompt bodies declare skill dependencies as `skill: name`; they do not assume a dedicated skill tool or hard-code this repository's commands into consumer workflows.

## Verification

```bash
npm run validate:skills
npm run typecheck
npm run typecheck:extensions
npm run test:all
npm run package:check
npm run pack:check
npm run smoke:resources
npm run smoke:packed
npm run check
```

Before publishing, run:

```bash
npm run release:check
```

The release gate runs the full project check, validates the npm payload, loads resources from an extracted package in an empty consumer directory, and performs a production dependency audit.
