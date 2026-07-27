# pi-harness

`pi-harness` is a reusable Pi Coding Agent harness: curated extensions, skills, prompt templates, themes, runtime policy, and a tested source-checkout profile.

## What's new in 1.2.0

- New **`workflow-state`** extension: durable foundation verdicts, reconcile checkpoints, and complete handoffs validated by `@minhduydev/pi-core`, with a reconcile trigger (CAS consume, completion threshold, inter-process file lock) and a multi-process contention fixture.
- **Skill consolidation**: 12 source skills merged into natural-named reference sets (see `.pi/skills/superpi/MIGRATIONS.md`).
- New release tooling: `quality-ratchet`, `suite-pins`, `registry-preflight`, `discover-gates`; new docs (`docs/workflow-state.md`, `docs/harness-profiles.md`, `docs/quality-ratchet.md`).
- Integration matrix and suite pins moved to the 0.2.0 / 0.9.0 / 0.4.0 / 0.4.0 release. See `CHANGELOG.md`.

## Requirements

- Node.js `>=22.19.0`
- npm `>=11.12.1`
- Pi Coding Agent `0.81.1` (tested against Pi 0.81.1; the package uses the active host's Pi packages through peer dependencies)

## Install as a Pi package

```bash
pi install npm:@minhduydev/pi-harness@1.2.0
```

Restart Pi after installation. Pi discovers the package manifest resources:

- `.pi/extensions/`
- `.pi/skills/`
- `.pi/prompts/`
- `.pi/themes/`

For a clean consumer setup, bootstrap only the portable settings and artifact
ignore file with the package CLI:

```bash
npx --package @minhduydev/pi-harness@1.2.0 pi-harness-init ./my-repo
```

The command deep-merges only missing portable settings and array entries into
an existing valid `.pi/settings.json`; consumer-owned values win, and rerunning
is idempotent. Existing agent profiles are never overwritten, and only missing
canonical profiles are copied. Use `--no-agents` when the consuming repository
owns its entire roster. The template never adds personal theme, editor,
provider, or model preferences.

Pi package discovery does **not** automatically apply this repository's root `AGENTS.md`, `.pi/settings.json`, or `.pi/agents/` directory. The bootstrap explicitly scaffolds `.pi/agents/` because `pi-subagents` discovers project-local profiles rather than package resources:

- Run `/init` in a consuming repository to create or update that repository's own `AGENTS.md` from observed facts.
- The delegated task runtime comes from `@minhduydev/pi-subagents`; canonical profiles come from the bootstrap and remain consumer-owned after creation.
- Existing profiles are never overwritten. Adapt or delete any role the consuming repository does not need.
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
- `/handoff` — write and persist a fourteen-section transfer contract.

The standard profile also enables typed workflow state: foundation verdicts,
backlog reconciliation checkpoints, and complete handoffs are validated by
`@minhduydev/pi-core` and stored as immutable digest-bound records. A durable
reconciliation reminder becomes due after four completed TODO items. See
`docs/workflow-state.md`.

Extension bundles, provider opt-ins, and independent Herdr worker-seat
restrictions are documented in `docs/harness-profiles.md`.

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
npm run release:check:local
npm run check
```

`release:check:local` builds and packs the four sibling checkouts next to this
repository, so it does not depend on unpublished suite versions. None of the
release scripts runs `npm publish`.

The owner-controlled publish order is:

1. `@minhduydev/pi-core@0.2.0`
2. `@minhduydev/pi-subagents@0.9.0`
3. `@minhduydev/pi-learning@0.4.0`
4. `@minhduydev/pi-todo@0.4.0`
5. `@minhduydev/pi-harness@1.2.0`

After the first four exact versions exist on npm, run the final registry gate
before publishing the harness:

```bash
npm run release:check:registry
```

The registry preflight distinguishes a genuinely missing version from a
network/authentication error or a wrong registry response. The release gate
runs the full project check, validates the npm payload, loads resources from an
installed package in an empty consumer directory, and performs a dependency
audit.
