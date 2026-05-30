# Delegation — Harness and Visible Workflows

Purpose: route work to the right execution layer without overusing the harness or hidden orchestration.

## Decision Priority

Apply these rules in order. Higher rules win over lower rules.

1. **Fix/update/refactor existing code** → use direct tools; do **not** use harness by default.
2. **Build/create/make a product-level artifact, app, feature, or multi-file codebase** → use `harness`.
3. **Create/edit docs, diagrams, prompts, config, tests for existing behavior, or agent files** → use direct tools unless the user explicitly asks for harness.
4. **Modify the harness extension itself** → prefer direct tools or an explicit file/tmux review workflow; do not recursively use harness unless the user explicitly asks.
5. **Research/explore/review/plan/visual audit** → use direct tools and visible `.pi/plans/<id>/` artifacts; self-spawn in tmux only when independent fresh context is worth the overhead.
6. **Ambiguous or destructive request** → ask before acting.

Examples:

```text
"create a todo app"                 → harness
"build a payment system"            → harness
"make a new React dashboard"         → harness
"create a harness agent prompt"      → direct tools
"write a system architecture diagram" → direct response / docs edit
"fix harness widget metrics"         → direct tools
"refactor existing auth module"       → direct tools, unless product-scale
"generate tests for existing parser"  → direct tools
```

## Layer 0: Build Harness

| Tool      | Purpose                                                           |
| --------- | ----------------------------------------------------------------- |
| `harness` | Multi-agent product build: planner → worker → reviewer/fixer loop |

### Use Harness For

- product-level app or feature creation;
- multi-file builds from a short product prompt;
- work that benefits from planner → worker → reviewer decomposition;
- work that benefits from isolated worktrees, fresh review, and durable artifacts.

### Do Not Use Harness For

- tiny mechanical edits;
- docs, diagrams, prompt, config, or agent-file changes;
- tests for existing behavior;
- harness internals unless the user explicitly asks;
- changes where current conversation context is essential.

Harness internals are modular. Do not assume source layout; inspect current files before modifying the harness.

Default harness agents live in `.pi/agents/harness-{planner,worker,reviewer}.md`. Configure harness prompts and agent-level models there.

`inheritContext` defaults to `false`; harness agent files are standalone system prompts. Only enable inherited context when explicitly useful.

### Harness Model Selection

Harness model priority is:

```text
tool parameter > agent frontmatter > active model fallback
```

Prefer stable harness-agent defaults in `.pi/agents/harness-{planner,worker,reviewer}.md`; use tool parameters for one-off overrides.

## How to Call `harness`

For non-trivial harness calls, emit a short analysis block before calling the tool:

```text
[Harness Analysis]
  Task: one-line summary
  Complexity: trivial | simple | medium | complex | critical
  Pattern: producer-reviewer | pipeline
  Reasoning:
    - Files involved: ~N
    - Business logic: yes/no
    - Edge cases: yes/no
    - Data persistence: yes/no
    - UI/CLI: yes/no
    - Risk if broken: low/medium/high
  Iterations: N
```

For trivial harness calls, a one-line analysis is enough.

### Pattern Selection

| Pattern             | Use When                                                                                        | Behavior                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `producer-reviewer` | Correctness matters, business logic, persistence, security, UI behavior, non-trivial edge cases | Worker builds → reviewer evaluates → worker fixes until pass or max iterations |
| `pipeline`          | Prototype, boilerplate, known trivial output, no meaningful review needed                       | Planner → worker only                                                          |

### Iteration Selection

| Iterations | Use When                                                |
| ---------: | ------------------------------------------------------- |
|          1 | trivial, single file, no meaningful edge cases          |
|          2 | simple/medium, a few files, basic edge cases            |
|          3 | standard multi-file work with business logic            |
|        4-5 | complex, security/data integrity, high correctness risk |

Actively choose parameters. Do not blindly rely on defaults.

## Post-Harness Acceptance Gate

Harness output is not proof. After any harness run that changes files:

1. Inspect the harness worktree diff.
2. Reject unrelated changes.
3. Run verification in the worktree.
4. Copy or accept only scoped files into the main workspace.
5. Run verification again in the main workspace.
6. Check acceptance criteria against the original user request.
7. Do not commit or push unless the user asks.

Never stage with `git add .`. Stage explicit files only.

## Scoped Context Files

Pi automatically loads global, parent, and current-directory `AGENTS.md`/`CLAUDE.md` files at session start. Do **not** scan and load every subdirectory context file.

When working in a specific subtree or editing files under a new area, check for the nearest relevant context file before changing code:

```sh
p="$(cd "$(dirname <target-file>)" && pwd)"
while [ "$p" != "/" ]; do
  [ -f "$p/AGENTS.md" ] && echo "$p/AGENTS.md"
  [ -f "$p/CLAUDE.md" ] && echo "$p/CLAUDE.md"
  p="$(dirname "$p")"
done
```

Read only context files that are in or above the target scope, or clearly govern the files being changed. Do not import unrelated skill/template `AGENTS.md` files just because they exist elsewhere in the repo.

## Layer 1: File/Tmux/Self-Spawn Workflows

Pi in this project should stay Mario-style minimal by default: direct tools first, then visible file artifacts, then tmux/self-spawn only when isolation is genuinely useful.

| Primitive                                           | Use For                                                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Direct tools                                        | Normal coding, review, edits, tests, and research in the current session                                                |
| `.pi/plans/<id>/SPEC.md` / `.pi/plans/<id>/PLAN.md` | Durable planning instead of hidden plan mode                                                                            |
| `TODO.md` / `.pi/plans/<id>/PROGRESS.md`            | Durable progress tracking with plain files                                                                              |
| `.pi/cli/*.mjs`                                     | Repeatable local automation wrappers when direct shell commands become error-prone; especially browser evidence capture |
| `tmux`                                              | Dev servers, logs, long-running commands, and observable side sessions                                                  |
| `pi --print/--print-turn` in tmux                   | Explicit self-spawn for isolated review/research when needed                                                            |
| `harness`                                           | Product-level planner → worker → reviewer loops with observable tmux watch artifacts                                    |

If another Pi session is useful, spawn it explicitly via `bash`/`tmux` with a written prompt/artifact path, then inspect its output before acting.

Use `.pi/cli/` wrappers when a workflow needs repeatable local evidence but should not become a Pi extension. Current browser wrappers:

- `.pi/cli/browser-devtools.mjs` for inspecting an existing Chrome DevTools target and writing `BROWSER-DEVTOOLS.md`.
- `.pi/cli/playwright-flow.mjs` for scripted browser flows with screenshots/logs and `PLAYWRIGHT-FLOW.md`.
- `.pi/cli/browser-screenshot.mjs` for deterministic responsive screenshots and `SCREENSHOTS.md`.

Prefer direct shell commands for one-offs; add or use `.pi/cli` only when repeatability/artifact capture matters.

## Layer 2: Minimalism Gate

Before using harness, tmux self-spawn, or any heavy external integration, ask:

- Can direct tools solve this in the current session?
- Can direct shell or an existing `.pi/cli/*.mjs` wrapper produce the needed evidence?
- Can a file artifact (`PLAN.md`, `TODO.md`, `PROGRESS.md`, `REVIEW.md`) replace hidden runtime state?
- Would tmux make the process more observable?
- Will `.pi/cli` output be written under `.pi/plans/<id>/` or another explicit artifact path and independently verified before being trusted?

## Delegation Rules

Prefer doing the work yourself when:

- the request is surgical or follows current context;
- only a few tool calls are needed;
- ambiguity or safety requires direct judgment;
- a hidden worker would make provenance harder to inspect.

Use explicit tmux/self-spawn only when:

- the work is independent and benefits from fresh context;
- the prompt and expected artifact are written to disk first;
- the spawned session is visible or its logs/output are saved;
- you will re-read changed files and verify results yourself.

## Self-Spawn and Harness Distrust

Never accept self-spawn, tmux, or harness reports blindly.

Required after delegated or harness implementation:

1. Read changed files directly.
2. Review the diff.
3. Run relevant tests/typechecks/lints.
4. Confirm scope was respected.
5. Report verification evidence.

## Context File Pattern

For complex handoffs, write shared context once and point the visible workflow to it:

```sh
mkdir -p .pi/plans/<id>
$EDITOR .pi/plans/<id>/WORKER-CONTEXT.md
pi --name "review <id>" --print-turn "Read .pi/plans/<id>/WORKER-CONTEXT.md and produce .pi/plans/<id>/REVIEW.md"
```

Use this when shared context is larger than ~500 tokens, multiple sessions need the same background, or a plan/spec must survive handoffs.

## Context Retrieval Routing

Use `memory-search` for durable project knowledge: prior decisions, repeated bugfixes, architecture patterns, warnings, and lessons that should survive beyond the current conversation.

Use `vcc_recall()` for current-session or recent-history recovery: compressed details, earlier tool output, commands already run, user decisions, and “continue from before” context.

After either retrieval path, verify current code, config, git state, and file contents from disk before acting. Neither memory nor session history is proof of current workspace state.

Serialize `compress` calls; never run multiple compressions in parallel.
