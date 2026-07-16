# Workflow

This file is the runtime playbook: when to work directly, when to delegate, and how to orchestrate.

## Routing

| Shape | Action |
| ----- | ------ |
| Question / lookup / one-file task / 2-3 file local fix | Direct tools |
| Bounded subtask, clear scope, parent context not needed | `task` |
| Long-running, parallel, adversarial, or unknown-size work | Workflow-style orchestration with `task` |
| Product from short prompt where direct implementation would sprawl | Workflow-style orchestration with `task` |

Default to direct work unless delegation clearly reduces total review load.
Workflow-style orchestration means explicit fan-out, reviewer separation, or loop-until-done with a real stop condition.
Over-engineered → push back. Independent `task` calls → one message, parallel.
Parent verifies artifacts — never ship on subagent summary alone.

## Delegation

Use `task` when isolation, repo discovery, parallelism, or independent verification is worth the review cost.

`task` prompt must include: goal, non-goals, write/read policy, expected output, stop condition, verification recipe.

Agent defaults:
- `explore`: unfamiliar repo, multi-module discovery, path:line before edit
- `scout`: docs, APIs, web, external evidence
- `general`: bounded implementation or multi-step work
- `reviewer`: after non-trivial edits or for independent judgment checks

WIP cap: max 1 implementation agent + 1 reviewer unless tasks are fully independent.
Do not edit files owned by a running background task.

## Completion Gate

Non-trivial work means any of:
- behavior-changing code
- more than 1 file edited
- more than 2 repair loops
- research or audit where claims need verification

For non-trivial code changes: run `task(reviewer)` with touched paths, or report `REVIEW_SKIPPED: <reason>`.
For judgment-heavy research: use an independent verifier or skeptic, not only the producer.

## Context Retrieval

Trust repo reality over prompt habit.
Retrieval order:
1. current repo state on disk
2. project memory
3. delegated repo exploration if needed
4. external docs or web

Use `dcp_recall` before guessing about compacted context.
Verify recalled or delegated claims on disk before acting.

## Web Retrieval

Use this order:
1. `context7` / `deepwiki`
2. `websearch` / `codesearch`
3. `web_fetch`
4. browser only if JS is required

## TODO Tracking

Update `.pi/artifacts/TODO.md` for multi-step work, audits, plans, or changes touching more than 1 file.
Use ADRs only for real tradeoffs.

## Anti-Patterns

- silent assumptions
- over-engineering
- noisy diffs
- vague "done"
- stale-view retries without re-reading
- broad staging in a dirty worktree
- claiming success without verification evidence
- producer grading its own judgment-heavy output
- single-pass handling of unknown-size tasks
