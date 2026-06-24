# Workflow Routing

**Before routing, check yourself:** If the request is ambiguous — surface alternatives. If the solution is over-engineered — push back. These are not optional courtesies; they are the highest-priority operation.

## Routing Rules

1. **Direct tools** for: fix/refactor existing code, harness-self-modify, doc/config/prompt edits, research/plan/audit. No `harness`, no `task`.
2. **Delegate** (`harness` for product builds, `task` for bounded subtasks) — see **Delegation** below for the `task` schema and agent types.
3. **Ask first** when: the request is ambiguous, destructive, touches secrets/auth, or is a large refactor without clear scope.

## Delegation

**`task` tool shape:** `{ agent_type, description, prompt, background?, conversation_id? }`
- `agent_type` (required) — pick from the table below
- `description` (3-5 words, required) — UI label
- `prompt` (required) — see template
- `background` (default `false`) — `true` only when you can do other work first
- `conversation_id` — reuse for continuity with a prior specialist call

**Agent types (pi-task built-in; project can add at `.pi/agents/<name>.md`):**
- `scout` — external research, web/docs, cited guidance
- `explore` — read-only code exploration, file:line evidence
- `planner` — implementation plan + risk + acceptance, no edits
- `reviewer` — post-change audit (correctness/security/regression), file:line evidence
- `vision` — UI/UX visual review from screenshots or code
- `worker` — small scoped implementation, runs checks, reports files changed

**Pick by task shape:**
- find / research / cite → `scout`
- map / locate / where is → `explore`
- plan / design / how to implement → `planner`
- review / audit / check this change → `reviewer`
- UI / visual / layout → `vision`
- implement / make this small change → `worker`

**Do yourself (don't delegate):** ≤3 tool calls, 1-2 files, secrets, edits needing current-conversation nuance, anything you'd just re-verify yourself.

**Ask first** — see Routing Rule 3.

**Prompt template (mandatory fields):**
- Goal, non-goals
- Write policy (edit / no-edit / allowed paths)
- Read policy (conventions, prior outputs to consume)
- Expected output (artifact path or report shape)
- Stop condition
- Failure handling (return partial / retry / stop)
- Verification: parent reads the file, never trusts the summary

**Parallel:** fire all independent `task` calls in one block.

**Verification (non-negotiable):** read the artifact, review the diff, run the check. Sub-agent self-report is untrusted.

## Skills

Before non-trivial work, read the `description:` line of every `SKILL.md` under `.pi/skills/`, then read the full text of any whose description matches the current task. Follow the skill's instructions over the rules in this file when they conflict.

## Artifacts

For any task with >= 2 tool calls or >= 2 files modified, read `skills/artifact-format/SKILL.md` and follow it. The first action is to append a `### YYYY-MM-DD - <title>` block with `status: active | updated: <date>` to `.pi/artifacts/TODO.md` (or PLAN/PROGRESS/DECISIONS.md if escalated). Canonical files: `.pi/artifacts/{TODO,PLAN,PROGRESS,DECISIONS}.md`.

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
