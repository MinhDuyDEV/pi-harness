# Workflow

## Routing

| Shape | Action |
| ----- | ------ |
| Fix / refactor / doc / research / plan / audit (narrow) | Direct tools |
| Bounded subtask, clear scope | `task` |
| Product from short prompt | `harness` |
| Ambiguous / destructive / secrets | Ask first |

Ambiguous request → state alternatives. Over-engineered → push back. Independent `task` calls → one message, parallel. **Parent verifies artifacts** — never ship on subagent summary alone.

## Delegation

**Parent direct:** ≤3 tool calls, 1–2 files, secrets, nuance from this thread. **Not `task`:** one known path (`read`), one symbol (`grep`/`find`), 2–3 files (`read`/`rg -n`), quick fact here, greenfield (`harness`). Roster detail: `~/.pi/agent/agents/README.md`.

**`task` prompt must include:** goal, non-goals, write/read policy, expected output, stop condition, verification recipe. Child gets agent `.md` + your prompt only — not `APPEND_SYSTEM`/`AGENTS` unless you point at project `AGENTS.md` (general: Edit Protocol; explore/scout: read-only). Default `background: true`; resume via `task_id` / `conversation_id`. Slash/command delegation → full invocation in `prompt`.

| Trigger (no user @mention when `proactive: true` in task catalog) | `task` agent | Use instead |
| ------------------------------------------------------------------- | ------------ | ----------- |
| Unfamiliar repo, multi-module, path:line before edit | `explore` | Parent grep/read tour |
| Docs, API, web not in repo | `scout` | Parent websearch only |
| Multi-step work, implementation, parallel tracks | `general` | Parent doing same slice inline |
| After non-trivial edits, before done/commit | `reviewer` | Self-review only |
| Full app from prompt | `harness` | Many chained `general` calls |

**Completion gate:** Code changed this session → `task(reviewer)` with paths touched, or `REVIEW_SKIPPED: <reason>` before claiming done. `harness-*` → `harness` tool only.

## Context Retrieval

`dcp_recall` → delegate if needed → verify on disk. Memory: `memory` skill. TS/JS edits: `npx fallow health --changed-since main` when non-trivial.

## Web Retrieval

`context7` / `deepwiki` → `websearch` / `codesearch` → `web_fetch` → `webclaw_*` → browser only if JS required.

## TODO Tracking

≥2 tool calls or ≥2 files: append `### YYYY-MM-DD - <title>` to `.pi/artifacts/TODO.md` per `skills/artifact-format/SKILL.md`. ADR only for real tradeoffs.

## Anti-Patterns

| Signal | Apply |
| ------ | ----- |
| Silent assumption | Kernel #1 |
| Over-engineering | Kernel #2 |
| Noisy diff | Kernel #3 |
| Vague "done" | Kernel #4 |
| Orphans after edit | Edit Protocol ORPHANS |
| Using `oldText`/`newText` when `hashline_read` is available | Use `hashlineChanges` — it's strict, atomic, and detects stale views |
| Reading with `read` right before a non-trivial edit | Use `hashline_read` first — you need the hashes for `hashlineChanges` |
| Retrying a hashline edit after `E_STALE_ANCHOR` with the old hashes | Re-read with `hashline_read`, then retry with new anchors |

