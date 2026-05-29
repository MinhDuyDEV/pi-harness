# Delegation — Harness, Agents, and Tasks

Purpose: route work to the right execution layer without overusing the harness or losing safety.

## Decision Priority

Apply these rules in order. Higher rules win over lower rules.

1. **Fix/update/refactor existing code** → use direct tools or `worker`; do **not** use harness by default.
2. **Build/create/make a product-level artifact, app, feature, or multi-file codebase** → use `harness`.
3. **Create/edit docs, diagrams, prompts, config, tests for existing behavior, or agent files** → use direct tools unless the user explicitly asks for harness.
4. **Modify the harness extension itself** → prefer direct tools or isolated worktree review; do not recursively use harness unless the user explicitly asks.
5. **Research/explore/review/plan/visual audit** → use the matching specialist agent.
6. **Ambiguous or destructive request** → ask before acting.

Examples:

```text
"create a todo app"                 → harness
"build a payment system"            → harness
"make a new React dashboard"         → harness
"create a harness agent prompt"      → direct tools
"write a system architecture diagram" → direct response / docs edit
"fix harness widget metrics"         → direct tools or worker
"refactor existing auth module"       → direct tools / worker, unless product-scale
"generate tests for existing parser"  → direct tools / worker
```

## Layer 0: Build Harness

| Tool | Purpose |
|---|---|
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

| Pattern | Use When | Behavior |
|---|---|---|
| `producer-reviewer` | Correctness matters, business logic, persistence, security, UI behavior, non-trivial edge cases | Worker builds → reviewer evaluates → worker fixes until pass or max iterations |
| `pipeline` | Prototype, boilerplate, known trivial output, no meaningful review needed | Planner → worker only |

### Iteration Selection

| Iterations | Use When |
|---:|---|
| 1 | trivial, single file, no meaningful edge cases |
| 2 | simple/medium, a few files, basic edge cases |
| 3 | standard multi-file work with business logic |
| 4-5 | complex, security/data integrity, high correctness risk |

Actively choose parameters. Do not blindly rely on defaults.

## Post-Harness Acceptance Gate

Subagent success is not proof. After any harness run that changes files:

1. Inspect the harness worktree diff.
2. Reject unrelated changes.
3. Run verification in the worktree.
4. Copy or accept only scoped files into the main workspace.
5. Run verification again in the main workspace.
6. Check acceptance criteria against the original user request.
7. Do not commit or push unless the user asks.

Never stage with `git add .`. Stage explicit files only.

## Layer 1: Specialist Agents

| Agent | Use For |
|---|---|
| `scout` | external research, docs, comparisons |
| `explore` | codebase search, usage tracing, architecture discovery |
| `reviewer` | bug/security/correctness review |
| `planner` | architecture and implementation plans |
| `vision` | screenshots, UI/UX/accessibility judgment |
| `worker` | small scoped implementation or fixes |

Use subagents when the work is independent enough to benefit from fresh context. Do it yourself when current conversation state, safety, or exact user intent is critical.

## Layer 2: Task Orchestration

| Tool | Purpose |
|---|---|
| `TaskCreate` | create durable tasks |
| `TaskUpdate` | claim/complete/update tasks |
| `TaskExecute` | run agent-backed tasks |
| `TaskOutput` | retrieve task output |
| `TaskStop` | stop task execution |

Use task orchestration for multi-step work with dependencies or persistent handoffs. If the task store is unavailable, proceed directly and state the blocker briefly.

## Delegation Rules

Delegate when:

- the task needs 3+ tool calls **and** does not depend heavily on current conversation context;
- the task matches a specialist role;
- parallel independent work exists;
- external research or broad codebase exploration is needed.

Do it yourself when:

- only 1-2 tool calls are needed;
- the request is a tight follow-up using current context;
- the change is surgical;
- ambiguity or safety requires direct judgment;
- you are deciding which tool/agent should be used.

## Worker and Harness Distrust

Never accept subagent or harness self-reports blindly.

Required after delegated implementation:

1. Read changed files directly.
2. Review the diff.
3. Run relevant tests/typechecks/lints.
4. Confirm scope was respected.
5. Report verification evidence.

## Context File Pattern

For complex delegation, write large shared context once and point agents to it:

```ts
write(".beads/artifacts/<id>/worker-context.md", contextContent);
Agent({ prompt: "Read worker-context.md and implement task 3." });
```

Use this when shared context is larger than ~500 tokens, multiple agents need the same background, or a plan/spec must survive handoffs.

## Context Continuity

Use `/dcp` to inspect context pressure and active compression blocks.
Use `vcc_recall()` for targeted session history recovery.
Serialize `compress` calls; never run multiple compressions in parallel.
