---
name: superpi
description: "Routes tasks to the smallest useful skill chain — selection principles plus a task-type routing table over the installed skills. Injected into the session by the superpi extension when enabled. User-invoked: load via /skill:superpi only when tuning Pi skill discovery or routing."
disable-model-invocation: true
---

# Pi skill routing

> Migration: this skill now owns the former `development-lifecycle` routing
> workflow. The artifact lifecycle itself remains the hidden, user-invoked
> `development-lifecycle` skill; this file only owns routing. See
> `MIGRATIONS.md`.

Pi discovers skill descriptions automatically and loads a full `SKILL.md` only when a task calls for it.

## Selection principles

- Inspect the task and repository state first; prefer project evidence over generic skill assumptions.
- Load the smallest relevant set — several matching descriptions is not a reason to load them all.
- If a skill references an unavailable tool, package, or path, report it and use a native fallback.
- Treat optional integrations as disabled until their dependencies are verified.
- Never block a request by asking the user to choose a skill first.

<!-- GENERATED ROUTES:START -->
## Routing table

Select one stage route, then add at most one matching domain overlay. Every model-visible skill is routed below or listed in `exemptions` in `route-metadata.json`.

| Axis | Task type | Skill chain (load order) |
| --- | --- | --- |
| stage | discover / research | `context-engineering` → `opensrc` |
| stage | create / specify | `spec-driven-development` → `brainstorming` |
| stage | plan / model | `planning-and-task-breakdown` → `domain-modeling` |
| stage | implement / test | `incremental-implementation` → `test-driven-development` → `testing-anti-patterns` |
| stage | debug / recover | `debugging-and-error-recovery` → `doubt-driven-development` |
| stage | review / verify | `code-review-and-quality` → `verification-before-completion` → `aislop` |
| stage | ship / release | `shipping-and-launch` → `code-cleanup` |
| domain | security-sensitive | `security-and-hardening` |
| domain | frontend / browser UI | `frontend-design` → `react-best-practices` → `playwright` |
| domain | TypeScript / domain-heavy | `typescript-coding-standards` → `deep-module-design` |
| domain | operations / external I/O | `observability-and-instrumentation` → `ci-cd-and-automation` |
| domain | migration / API change | `deprecation-and-migration` → `improve-codebase-architecture` |
| domain | documentation / ADR | `documentation-and-adrs` → `artifact-format` |
| domain | skill / tooling maintenance | `writing-skills` → `diagnostics` → `fallow` |
| domain | code search / transformation | `ast-grep` |
| domain | prototype / experiment | `prototype` |
| domain | grill / adversarial design | `grill-me` |
| domain | worktree / isolated change | `using-git-worktrees` |

<!-- GENERATED ROUTES:END -->

## Hard rules

Never load more than 3 skills for one task. If no skill matches, proceed without one — say so. The table is generated from `route-metadata.json`; edit that metadata, not the table.

Hidden skills are user-invoked via `/skill:<name>` and are never routed automatically.
