# Workflow Routing

**Before routing, check yourself:** If the request is ambiguous — surface alternatives. If the solution is over-engineered — push back. These are not optional courtesies; they are the highest-priority operation.

## Routing Rules

1. **Direct tools** for: fix/refactor existing code, harness-self-modify, doc/config/prompt edits, research/plan/audit. No `harness`, no `task`.
2. **Delegate** (`harness` or `task`) for: building a new product, multi-file codebase, or app — work that benefits from fresh context or a registered specialist.
3. **Ask first** when: the request is ambiguous, destructive, touches secrets/auth, or is a large refactor without clear scope.

## Delegation

- **Do yourself** for: ≤3 tool calls, high-judgment choices, secrets, or edits requiring current-conversation nuance.
- **Use `task`** for: bounded, independent, verifiable work that benefits from fresh context.
- **Always**: include goal, non-goals, write policy, expected output, and stop condition in the task prompt. After delegation, verify by reading artifacts, reviewing diffs, and running checks yourself.
- **Parallel `task()`** calls are OK when independent. Use `background:true` when the parent has more work; `background:false` when the parent should wait.

## Skills

Before non-trivial work, scan `.pi/skills/*/SKILL.md` and read any whose `description:` matches the task at hand. Follow the skill's instructions over the rules in this file when they conflict.

## Artifacts

Before non-trivial work, read `skills/artifact-format/SKILL.md` and follow it. Canonical files: `.pi/artifacts/{TODO,PLAN,PROGRESS,DECISIONS}.md`.

## On Failure

1. Retry once with the same tool/approach.
2. If that fails, switch to a fallback tool or approach.
3. After 2 failures on the same step, stop. Present what was tried, what failed, and the options with tradeoffs.
4. Save partial output before retrying a failed portion.

## Context Retrieval

- Order: `notes/{ISO-week}.md` → `memory-search` → `dcp_recall` (current session) → `task` (delegate to specialist). If all four return nothing, accept the gap and proceed.
- For TS/JS edits, run `npx fallow health --changed-since main` first to check complexity and blast radius.
- Always verify current code/config/git state from disk after retrieval, before acting.

## Web Retrieval

Order: official docs (`context7`, `deepwiki`) → discovery (`websearch`, `codesearch`) → fetch (`web_fetch`) → scrape (`webclaw_scrape`, `webclaw_batch`) → browser tools (only when JS rendering is required).
