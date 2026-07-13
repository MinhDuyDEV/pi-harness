# Workflow

## Routing

| Shape | Action |
| ----- | ------ |
| Fix / refactor / doc / research / plan / audit (narrow) | Direct tools |
| Bounded subtask, clear scope | `task` |
| Long-running / massively parallel / adversarial / ranking-heavy / unknown-cardinality task | Workflow-style orchestration with `task` |
| Product from short prompt | Workflow-style orchestration with `task` |

Over-engineered → push back. Independent `task` calls → one message, parallel. **Parent verifies artifacts** — never ship on subagent summary alone.

## Delegation

**Parent direct:** prefer direct work for narrow, local tasks with low context load: one known path (`read`), one symbol (`grep`/`find`), 2–3 files (`read`/`rg -n`), quick fact here, secrets, or nuance from this thread. Use `task` when isolation, parallelism, or repo discovery outweigh parent context. Escalate to workflow-style orchestration with `task` when the work needs classify-and-act, fan-out-and-synthesize, adversarial verification, tournament ranking, or loop-until-done behavior. Roster detail: `~/.pi/agent/agents/README.md`.

**`task` prompt must include:** goal, non-goals, write/read policy, expected output, stop condition, verification recipe. Child gets agent `.md` + your prompt only — not `APPEND_SYSTEM`/`AGENTS` unless you point at project `AGENTS.md` (general: Edit Protocol; explore/scout: read-only). Default `background: true`; resume via `task_id` / `conversation_id`. Slash/command delegation → full invocation in `prompt`.

| Trigger (no user @mention when `proactive: true` in task catalog) | `task` agent | Use instead |
| ------------------------------------------------------------------- | ------------ | ----------- |
| Unfamiliar repo, multi-module, path:line before edit | `explore` | Parent grep/read tour |
| Docs, API, web not in repo | `scout` | Parent websearch only |
| Multi-step work, implementation, parallel tracks | `general` | Parent doing same slice inline |
| After non-trivial edits, before done/commit | `reviewer` | Self-review only |
| Full app from prompt | Workflow-style orchestration with `task` | Parent doing the same orchestration inline |

**Completion gate:** Non-trivial code changed this session → `task(reviewer)` with paths touched, or `REVIEW_SKIPPED: <reason>` before claiming done. Judgment-heavy research, audits, rankings, or factual-claim checks should also use an independent verifier or skeptic, not just the producing agent. Tiny mechanical edits may self-review with cited verification.

## Context Retrieval

Trust repo reality over prompt habit: when policy text conflicts with live repo or tool reality, verify on disk before acting.

Retrieval order:
1. current repo state on disk
2. project memory (`memory` skill)
3. delegated repo exploration if needed
4. external docs or web

`dcp_recall` → delegate if needed → verify on disk. TS/JS edits: `npx fallow health --changed-since main` when non-trivial.

## Web Retrieval

`context7` / `deepwiki` → `websearch` / `codesearch` → `web_fetch` → browser only if JS required.

## TODO Tracking

For non-trivial work, follow `skills/artifact-format/SKILL.md` and update `.pi/artifacts/TODO.md`. ADR only for real tradeoffs.

## Anti-Patterns

| Signal | Apply |
| ------ | ----- |
| Silent assumption | Kernel #1 |
| Over-engineering | Kernel #2 |
| Noisy diff | Kernel #3 |
| Vague "done" | Kernel #4 |
| Orphans after edit | Edit Protocol ORPHANS |
| Failed replacement retried from a stale view | Re-read the exact region, then retry |
| Broad staging in a dirty worktree | Stage only touched files and review the diff |
| Claimed done without verification evidence | Mark `unverified` or run the check |
| Packaging or publish change without artifact inspection | Inspect the packed artifact contents before tag/publish |
| Single-agent handling of long-running parallel/adversarial work | Escalate to explicit workflow patterns using `task` |
| Producer grading its own judgment-heavy output | Add an independent verifier, skeptic, or tournament |
| Unknown-size task with one fixed pass | Use loop-until-done with a real stop condition |

