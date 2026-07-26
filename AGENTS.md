# Pi harness project instructions

This repository is a reusable Pi Coding Agent package. Follow host system, developer, and user instructions first; this file adds package-development guidance for this source checkout.

## Scope and ownership

- Keep reusable runtime policy in `.pi/APPEND_SYSTEM.md`; keep this repository's maintenance commands and layout here.
- As an installed package, this harness ships Pi resources (extensions, skills, prompts, themes) through Pi's manifest discovery, not the source-checkout maintenance layout documented below.
- Root `AGENTS.md` is Pi's active project-context location. `.pi/AGENTS.md` is not a supported duplicate and must stay absent.
- Skills hold detailed on-demand workflows. Prompt templates orchestrate those workflows. Avoid copying the same long rules into all three layers.

## Working rules

- Inspect the current repository state before editing and preserve unrelated user changes.
- Prefer small, reversible changes. Do not modify global Pi configuration or install unpinned packages as part of normal work.
- Use Pi-native resource conventions and exact tool names. Treat optional package tools as unavailable unless installed and loaded.
- Keep settings, agents, and prompts provider- and model-portable; do not commit credentials, personal paths, private endpoints, or machine-specific defaults.
- Subagents under `.pi/agents/` must have explicit write boundaries, structured output contracts, and runtime-selected models rather than provider pins.
- Prompt frontmatter must use fields supported by Pi. Prompt bodies must not emit fabricated tool-call syntax or assume commands from this repository will exist in a consumer repository.
- When changing behavior, update the closest focused test and observe it fail before implementing the fix when practical.
- Preserve public contracts and package payload intentionally; do not add compatibility shims or new dependencies without evidence.

## Repository conventions

- `.pi/settings.json` contains portable runtime settings and pinned package sources.
- `.pi/extensions/`, `.pi/skills/`, `.pi/prompts/`, and `.pi/themes/` are package resources discovered through Pi's manifest conventions.
- `.pi/agents/` contains definitions consumed by the pinned `@minhduydev/pi-subagents` extension, not by Pi core. (`@heyhuynhgiabuu/pi-task` is NOT pinned in `.pi/settings.json` and is not loaded.)
- `.pi/artifacts/` and `.pi/MEMORY.md` are local runtime state and must remain untracked.
- `skills-lock.json`, `package-lock.json`, package metadata, and release checks are tracked reproducibility contracts.

## Verification

- Run the narrowest relevant test or typecheck first.
- Run `npm run validate:skills` after skill or prompt-policy changes.
- Run both extension typechecks and their focused suites after extension changes.
- Run `npm run pack:check` after package metadata, payload, resource, or release-script changes.
- Before claiming completion, run `npm run check` (or record the exact blocker), then inspect `git diff --check` and the scoped final diff.
- Do not claim a test, build, package install, or publish check passed without the command and observed result.
