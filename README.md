# pi-harness

`pi-harness` is a reusable Pi Coding Agent harness: curated extensions, skills, prompt templates, themes, runtime policy, and a tested source-checkout profile.

## What's new in 2.1.0

- Global srcwalk-first navigation policy for the parent session and every standalone subagent.
- Exact `@sting8k/pi-srcwalk@1.2.8` integration with the installed binary's version-matched guide.
- Pi 0.81.1-compatible Snap Edit port with guarded atomic `quick_edit` and `target_edit` tools.
- Full-profile activation, read-output line numbering, focused regression coverage, and documented upstream provenance.

## Requirements

- Node.js `>=22.19.0`
- npm `>=11.12.1`
- Pi Coding Agent `0.81.1` (tested against Pi 0.81.1; the package uses the active host's Pi packages through peer dependencies)

## Bootstrap a consumer repository

One command installs the complete project-local **Full** harness contract; no
separate global or manual `pi install` is required:

```bash
npx --yes --package @minhduydev/pi-harness@2.1.0 pi-harness-init ./my-repo
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
it does not install optional system tools. Full settings enable the portable
provider adapters, but they do not require credentials at startup; credentials
are needed only when that provider is selected. Loaded integrations report
missing optional tools through `/integration` rather than making startup
depend on them.

### Rerun, preview, and upgrade

Use the same exact-version command for first install and reruns. An unchanged
rerun performs no content or timestamp writes. Preview a first install or
upgrade with:

```bash
npx --yes --package @minhduydev/pi-harness@2.1.0 pi-harness-init --dry-run ./my-repo
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

## srcwalk integration

The package requires [srcwalk](https://github.com/sting8k/srcwalk) for structural code navigation and ships a `srcwalk` skill with the version-matched workflow. Install the CLI before starting Pi; pi-harness does not download binaries during package installation or startup, so bootstrap remains deterministic.

Install it once in the consumer environment, or invoke it through `npx`:

```bash
npm install -g srcwalk
srcwalk guide
```

The skill routes repository orientation, symbol discovery, exact reads, caller/callee tracing, dependency and blast-radius checks, and Git review packets through srcwalk. It preserves `rg` and ordinary shell tools for regex/pure-text work and operations srcwalk does not support. srcwalk output is source evidence rather than runtime proof; tests and project checks remain authoritative.

The integration is version-resilient: the skill requires the current intent-first command family (`>=1.0.0`) and delegates detailed routing to the installed binary's version-matched `srcwalk guide`, avoiding a vendored or stale command reference.

## Snap Edit integration

The Full profile enables a Pi 0.81.1-compatible port of [pi-snap-edit](https://github.com/sting8k/pi-snap-edit) 4.2.2. It provides guarded, atomic `quick_edit` and `target_edit` tools and replaces the active built-in `edit`/`substitute_edit` tools at session start. Full consumer initialization manages this gate as enabled so every initialized agent gets the same editing contract; rerunning init restores that managed value.

The upstream npm package currently peers on Pi `^0.78.0`, so pi-harness does not force-install it into the 0.81.1 runtime. The vendored source and its single TypeBox import adaptation are documented in [`.pi/extensions/snap-edit/README.md`](.pi/extensions/snap-edit/README.md).

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
2. `@minhduydev/pi-subagents@0.10.1`
3. `@minhduydev/pi-learning@0.4.0`
4. `@minhduydev/pi-todo@0.4.0`
5. `@minhduydev/pi-harness@2.1.0`

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
