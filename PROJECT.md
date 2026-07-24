# Project contract

## Purpose

`pikit` packages a conservative set of Pi Coding Agent resources. It is a Pi package, not a standalone application or workbench server.

## Source of truth

- Package metadata and scripts: `package.json`
- Pi runtime settings: `.pi/settings.json`
- Resource entrypoints: `package.json` → `pi`
- Active project instructions: `AGENTS.md`
- Skill integrity: `skills-lock.json` and `npm run validate:skills`

Do not infer commands or paths from generated caches under `.pi/npm`, `.pi/git`, or `.pi/artifacts`.

## Runtime contract

Pi discovers the standard `.pi/extensions`, `.pi/skills`, `.pi/prompts`, and `.pi/themes` directories. Package-level peer dependencies are supplied by the host Pi installation; development dependencies are used only for local checks. Supplemental Pi packages are pinned in project settings and must be installed explicitly when this repository is consumed only as a package.

Project settings intentionally do not choose a provider, model, trust policy, or machine-specific path. Users can configure those globally or in their local Pi settings.

## Development gates

```bash
npm ci
npm run validate:skills
npm run package:check
npm run smoke:resources
npm run typecheck
npm run typecheck:extensions
npm run typecheck:extension-tests
npm run quality
npm run test:all
```

Use `npm run test:extensions` for extension-only iteration and `npm run test:skills` for root skill/context tests. Some extension tests require Bun because they use `bun:test`.

## Change policy

1. Inspect the current worktree and preserve unrelated edits.
2. Make the smallest change that satisfies the contract.
3. Add or update a behavior test when changing runtime behavior.
4. Pin new package sources and update `skills-lock.json` when skill content changes.
5. Record verification evidence before claiming completion.
