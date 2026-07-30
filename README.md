# pi-harness

`pi-harness` is a reusable Pi Coding Agent harness: curated extensions, skills, prompt templates, themes, runtime policy, and a tested source-checkout profile.

## What's new in 2.3.2

- V2 learning intents separate launch-time claims from completion-time evidence and bind reviewer support to the exact claim and artifact.
- The asynchronous context handshake reliably injects restart-safe learning into real subagent tasks and records durable usage and outcomes.
- Privacy-safe telemetry exposes bounded operational result codes without prompt text, learning content, paths, raw errors, or caller-controlled IDs.
- Packed production E2E proves persistence, restart, retrieval, injection, usage receipts, and positive outcomes across package boundaries.

## Requirements

- Node.js `>=22.19.0`
- npm `>=11.12.1`
- Pi Coding Agent `0.81.1` (tested against Pi 0.81.1; the package uses the active host's Pi packages through peer dependencies)

## Bootstrap a consumer repository

One command installs the complete project-local **Full** harness contract; no
separate global or manual `pi install` is required:

```bash
mkdir -p ./my-repo
npx --yes --package=@minhduydev/pi-harness@2.3.2 -- pi-harness-init ./my-repo
```

The bootstrap writes exact project package pins for the executing harness and
its companion packages, portable Full settings, all seven canonical agent
profiles, the complete `.pi/templates/` tree, `.pi/ANTI_PATTERNS.md`, and a
sentinel-managed harness region in `.pi/APPEND_SYSTEM.md`. It also adds a
sentinel-managed runtime-state block to the existing `.gitignore` without
ignoring trackable settings, agents, policy, or templates. The auditable
`.pi/pi-harness.lock.json` records the harness version, exact package suite,
and hashes of every harness-owned file or region.

The initializer does not choose a provider, model, theme, or credentials, and
it does not install global system tools. Srcwalk semantic tools are preferred when
the optional CLI is available; the managed parent and subagent policies explicitly
fall back to built-in repository navigation when it is absent. Full settings enable
the portable provider adapters, but they do not require credentials at startup;
credentials are needed only when that provider is selected. Loaded integrations
report missing optional tools through `/integration` rather than making startup
depend on them.

The Full package set also pins `@mrclrchtr/supi-ask-user@4.0.0`, which provides
the interactive TUI-only `ask_user` decision form used by lifecycle prompts.
Those prompts include a numbered plain-text fallback for non-TUI or degraded
sessions.

### Rerun, preview, and upgrade

Use the same exact-version command for first install and reruns. An unchanged
rerun performs no content or timestamp writes. Preview a first install or
upgrade with:

```bash
npx --yes --package=@minhduydev/pi-harness@2.3.2 -- pi-harness-init --dry-run ./my-repo
```

To upgrade, change only the exact harness version in the `npx` command and run
it again. Files and managed regions still matching the hashes in the lock are
updated safely; consumer packages and settings outside the harness-owned keys
remain. Consumer prose before or after the APPEND policy sentinels is always
preserved.

If a managed file or region differs from its recorded hash, init exits
non-zero, reports every conflict, and changes nothing. Review the new packaged
resource, then either merge it manually and update by rerunning, restore the
recorded content, or delete that one managed file so init can recreate it. Do
not edit lock hashes to bypass conflict detection.

Pi package discovery loads the pinned package's extensions, skills, prompts,
and themes. Project-local materialization is still required because
`pi-subagents` discovers consumer agent profiles locally and templates are
repository assets. Bootstrap intentionally does **not** copy root `AGENTS.md`,
`PROJECT.md`, `.pi/README.md`, `.pi/DESIGN.md`, `.pi/MEMORY.md`, credentials,
hooks, or generated runtime state.

Pi's `/init` has a distinct role: run it after bootstrap when you want Pi to
inspect the consumer repository and create or refresh that project's own
`AGENTS.md`. `pi-harness-init` owns portable harness resources; `/init` owns
observed project context.

## Source-checkout profile

When this repository is used directly, `.pi/settings.json` provides a pinned project profile for task delegation, diagnostics, source lookup, and web/documentation tools. The Full profile pins `@heyhuynhgiabuu/pi-search`, which supplies `websearch`, `codesearch`, `context7`, `deepwiki`, `web_fetch`, `get_fetch_content`, and optional Firecrawl tools. Search works without an API key through Exa MCP; `EXA_API_KEY`, `BRAVE_API_KEY`, and `FIRECRAWL_API_KEY` enable their corresponding optional providers. Optional packages remain optional at runtime: prompts and policies must degrade explicitly when a tool is unavailable.

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

The Full profile also enables typed workflow state: foundation verdicts,
backlog reconciliation checkpoints, and complete handoffs are validated by
`@minhduydev/pi-core` and stored as immutable digest-bound records. A durable
reconciliation reminder becomes due after four completed TODO items. See
`docs/workflow-state.md`.

Extension bundles, provider opt-ins, and independent Herdr worker-seat
restrictions are documented in `docs/harness-profiles.md`.

Prompt frontmatter uses only Pi-supported fields. Prompt bodies declare skill dependencies as `skill: name`; they do not assume a dedicated skill tool or hard-code this repository's commands into consumer workflows.

## Performance baseline

Run the optional Full-profile baseline without network or provider calls:

```bash
npm run benchmark:full
```

The JSON report records local resource-loader startup timings, the byte size and
labelled token estimate for portable policy plus discovered skill descriptions,
and sequential Todo-file stat timings as a periodic-update I/O proxy. These are
descriptive measurements, not CI thresholds. The report lists its environment
and limitations; collect comparable runs before proposing an optimization.

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
npm run release:check:offline
npm run check
```

`release:check:local` builds and packs the four sibling checkouts next to this
repository, so it does not depend on unpublished suite versions. None of the
release scripts runs `npm publish`.

`release:check:offline` runs the same local deterministic gates but skips
`npm audit`, which requires registry access. It is intended for air-gapped or
temporarily disconnected environments and **does not** make a dependency-audit
or supply-chain freshness claim. Use the normal local or registry gate before
publishing once network access is available.

The owner-controlled publish order is:

1. [`@minhduydev/pi-core@0.3.0`](https://www.npmjs.com/package/@minhduydev/pi-core/v/0.3.0)
2. [`@minhduydev/pi-subagents@0.11.0`](https://www.npmjs.com/package/@minhduydev/pi-subagents/v/0.11.0)
3. [`@minhduydev/pi-learning@0.5.0`](https://www.npmjs.com/package/@minhduydev/pi-learning/v/0.5.0)
4. [`@minhduydev/pi-todo@0.4.2`](https://www.npmjs.com/package/@minhduydev/pi-todo/v/0.4.2)
5. [`@minhduydev/pi-harness@2.3.2`](https://www.npmjs.com/package/@minhduydev/pi-harness/v/2.3.2)

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
