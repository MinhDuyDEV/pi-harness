# Workflow

## Routing

| Shape                                          | Action                       |
| ---------------------------------------------- | ---------------------------- |
| Fix / refactor / doc / research / plan / audit | Direct tools. No delegation. |
| Bounded subtask with clear scope               | `task`                       |
| Multi-agent product build                      | `harness`                    |
| Ambiguous / destructive / touches secrets      | Ask first                    |

**Before routing:** If the request is ambiguous, surface alternatives. If the solution is over-engineered, push back.

**Parallel:** Fire all independent `task` calls in one block.
**Verification:** Parent reads the artifact, never trusts the sub-agent's summary.

## Delegation

**Do yourself:** ≤3 tool calls, 1-2 files, secrets, or edits needing current-conversation nuance.

**Agent types** (full detail: `~/.pi/agent/agents/README.md` — read once, cache):

| Agent      | Use for                                                         |
| ---------- | --------------------------------------------------------------- |
| `scout`    | External research, web/docs, cited guidance                     |
| `explore`  | Read-only code exploration, file:line evidence                  |
| `planner`  | Implementation plan + risk + acceptance, no edits               |
| `reviewer` | Post-change audit, file:line evidence                           |
| `vision`   | UI/UX visual review from screenshots or code                    |
| `worker`   | Small scoped implementation, runs checks, reports files changed |

**Prompt template** (mandatory): goal, non-goals, write policy, read policy, expected output, stop condition, failure handling. Parent reads the artifact — never trusts the summary.

**Subagent propagation:** Subagents have their own context and do not inherit APPEND_SYSTEM.md or AGENTS.md. The subagent sees its agent-specific rules file (e.g., `~/.pi/agent/agents/worker.md`) plus your task prompt. In the task prompt: tell the subagent to read `~/.pi/agent/AGENTS.md` if any of those rules apply, name which rules apply (a scout does not need the Edit Protocol; a worker does), state a specific stop condition and give a verification recipe (bad: "when done"; good: "when `pnpm test` returns 0 — subagent is responsible for self-verification before reporting back"), state the failure handling (return with what you tried, what failed, options for the parent), and specify exactly what the subagent should return in its final and only message to you (one message, defined up front). Pass only the context the subagent needs — a pointer to AGENTS.md counts; dumping your conversation does not. Don't spawn a subagent for: reading a specific file, searching for a class definition, scanning 2-3 files, or any task answerable with a single direct tool call. Subagents are for bounded subtasks that need their own context and tool sequence. The artifact is what the subagent wrote or changed; the summary is what the subagent says it did. Read the artifact.

## Context Retrieval

Order: `dcp_recall` (current session) → `task` (delegate). If all return nothing, accept the gap. Always verify current code/config/git state from disk after retrieval, before acting. Memory recall is handled by the `memory` skill (its description is in the system prompt).

For TS/JS edits: run `npx fallow health --changed-since main` first to check complexity and blast radius.

## Web Retrieval

Order: official docs (`context7`, `deepwiki`) → discovery (`websearch`, `codesearch`) → fetch (`web_fetch`) → scrape (`webclaw_scrape`, `webclaw_batch`) → browser tools (only when JS rendering required).

## TODO Tracking

For tasks with >= 2 tool calls or >= 2 files modified, follow `skills/artifact-format/SKILL.md`. First action: append a `### YYYY-MM-DD - <title>` block to `.pi/artifacts/TODO.md`. Escalate to `.pi/artifacts/DECISIONS.md` (ADR) only when a real architectural tradeoff exists.

## Anti-Patterns

| If you see...                  | Apply...                               |
| ------------------------------ | -------------------------------------- |
| Silent assumption              | Kernel #1 (clarify when ambiguous)     |
| Over-engineered solution       | Kernel #2 (smallest working change)    |
| Noisy diff / drive-by refactor | Kernel #3 (surgical diffs)             |
| Vague completion claim         | Kernel #4 (define proof before acting) |
| Dead code after your edits     | Edit Protocol ORPHANS step             |
