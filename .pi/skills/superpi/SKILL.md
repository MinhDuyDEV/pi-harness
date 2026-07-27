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

Match the task to a row, then load the listed skills in order. A parenthesized condition in a skill is optional; the route itself is never more than three skills.

| Task type | Skill chain (load order) |
| --- | --- |
| New feature | `spec-driven-development` → `planning-and-task-breakdown` → `test-driven-development` |
| Bug fix | `debugging-and-error-recovery` → `test-driven-development` → `verification-before-completion` |
| Refactor / architecture | `improve-codebase-architecture` → `deep-module-design` → `code-cleanup` |
| Frontend / UI | `frontend-design` → `react-best-practices` → `playwright` |
| Testing | `test-driven-development` → `testing-anti-patterns` |
| Review / ship | `code-review-and-quality` → `verification-before-completion` → `shipping-and-launch` |
| Research | `context-engineering` → `opensrc` |
| Docs | `artifact-format` |

<!-- GENERATED ROUTES:END -->

## Hard rules

Never load more than 3 skills for one task. If no skill matches, proceed without one — say so. The table is generated from `route-metadata.json`; edit that metadata, not the table.

Hidden skills are user-invoked via `/skill:<name>` and are never routed automatically.
