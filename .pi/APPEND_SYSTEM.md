# Workflow Routing

Route work to the right execution layer. Apply these in order.

## Decision Priority

1. **Fix/update/refactor existing code** → direct tools; do **not** use harness by default.
2. **Build/create/make a product-level artifact, app, feature, or multi-file codebase** → `harness`.
3. **Create/edit docs, diagrams, prompts, config, tests for existing behavior, or agent files** → direct tools unless the user explicitly asks for harness.
4. **Modify the harness extension itself** → direct tools or an explicit file/tmux review workflow; do not recursively use harness unless the user explicitly asks.
5. **Research/explore/review/plan/visual audit** → direct tools and visible `.pi/artifacts/<id>/` artifacts; self-spawn in tmux only when independent fresh context is worth the overhead.
6. **Ambiguous or destructive request** → ask before acting.

## Primitive Table

| Primitive | Use For |
|---|---|
| Direct tools | Normal coding, review, edits, tests, research |
| `.pi/artifacts/<id>/PLAN.md` / `PROGRESS.md` | Visible planning and tracking |
| `TODO.md` | Task checklist per artifact |
| `.pi/cli/*.mjs` | Repeatable browser/automation wrappers |
| `tmux` | Dev servers, logs, long-running commands |
| `pi --print/--print-turn` in tmux | Self-spawn isolated review/research |
| `npx fallow` / `fallow-mcp` | Codebase analysis before and after TS/JS edits — dead code, dupes, complexity, blast radius |
| `harness` | Product-level planner → worker → reviewer builds |

## Minimalism Gate

Before harness, tmux, or self-spawn:

- Can direct tools solve this in the current session?
- Can a file artifact replace hidden runtime state?
- Would tmux make the process more observable?
- Will output be written under `.pi/artifacts/<id>/` and independently verified?

## Delegation Rules

**Do it yourself** when: surgical request, few tool calls, ambiguity needs direct judgment, provenance matters.

**Spawn** (tmux/self-spawn) when: work is independent and benefits from fresh context, prompt and expected artifact are written to disk first.

## Self-Spawn and Harness Distrust

Never accept delegated output blindly. After any delegated or harness run:

1. Read changed files directly.
2. Review the diff.
3. Run verification.
4. Confirm scope was respected.
5. Report verification evidence.

## Artifacts

Before non-trivial implementation, write `.pi/artifacts/<id>/PLAN.md` with a `## Discovery` section. Track steps in `TODO.md` (checkbox format). Track narrative decisions and notes in `PROGRESS.md`. Both are mandatory. Skip for: one-line fixes, docs-only, config tweaks, trivial tests.

TODO.md creation and checkbox protocol is defined in `AGENTS.md` Hard Constraints — follow it.

## Quality Loop

After any non-trivial implementation, run an iterative fix-verify loop (see `quality-loop` skill):

1. Run all quality gates (typecheck → lint → tests → TODO.md → stubs)
2. If any fail: auto-fix, re-run gates, repeat
3. Max 3 iterations (harness) or 2 iterations (direct worker)
4. Report outcome with iteration count and remaining issues

Skip only for: one-line fixes, docs-only, config tweaks, trivial tests that cannot break existing behavior.

For complex handoffs, write shared context to `.pi/artifacts/<id>/WORKER-CONTEXT.md`, then point a spawned session to it:

```
mkdir -p .pi/artifacts/<id>
pi --name "review <id>" --print-turn "Read .pi/artifacts/<id>/WORKER-CONTEXT.md and produce .pi/artifacts/<id>/REVIEW.md"
```

## Context Retrieval

- `memory-search` → durable project knowledge (prior decisions, bugs, patterns, warnings)
- `vcc_recall()` → current-session recovery (earlier output, commands, user decisions)
- `npx fallow health --changed-since main --format json` → complexity and blast-radius context before editing TS/JS files; see `.pi/skills/fallow/SKILL.md`

After either path, verify current code/config/git state from disk before acting. Serialize `compress` calls — never run multiple compressions in parallel.
