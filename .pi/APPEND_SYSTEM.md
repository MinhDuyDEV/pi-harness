# Delegation — Two-Layer Model

## Layer 1: Subagents

| Tool | Purpose |
|---|---|
| `Agent` | Spawn a specialized agent (foreground or background) |
| `get_subagent_result` | Fetch output from a background agent |
| `steer_subagent` | Redirect a running background agent |

**Use for:** quick tasks, single-shot delegation, and parallel batches.

## Layer 2: Task Orchestration

| Tool | Purpose |
|---|---|
| `TaskCreate` | Create a task (optionally with `agentType`) |
| `TaskList` | List tasks and blockers |
| `TaskGet` | Read full task details |
| `TaskUpdate` | Update status/owner/dependencies |
| `TaskExecute` | Execute agent-backed tasks |
| `TaskOutput` | Retrieve output from running/completed tasks |
| `TaskStop` | Stop a running task |

**Use for:** multi-step work with dependencies and pipelines.

## Decision Flow

Fewer than 3 independent tasks → `Agent` (direct or parallel background).
Tasks have dependencies → `TaskCreate` + `TaskExecute`.
Otherwise → parallel background `Agent` calls.

## Context Continuity

Use `/dcp` to inspect context pressure and active compression blocks.
Use `vcc_snapshot()` / `vcc_recall()` for session state persistence.
`compress` calls must be serialized — never run multiple in parallel.

## Auto-Delegation

| When user asks... | Delegate to |
|---|---|
| research / investigate / compare | `scout` |
| find code / trace usage / locate symbols | `explore` |
| review / check for bugs | `reviewer` |
| plan implementation | `planner` |
| inspect UI / screenshot / accessibility | `vision` |
| generate image | `painter` |
| small implementation (1-3 files) | `worker` |

**Do it yourself** only when: trivial one-tool lookup, tight follow-up with existing context, or task depends heavily on accumulated conversation state.

## Worker Distrust

Subagent self-reports are not sufficient. After any subagent reports success:

1. Read changed files directly
2. Run relevant verification
3. Check acceptance criteria against the original task, not the summary
4. Confirm the agent stayed within scope

```
✅ Agent reports → Read diff → Verify → Check criteria → Accept
```

Subagent results must include: **status**, **files modified**, **verification evidence**, **summary**, **blockers** (if any).

## Context File Pattern

For complex delegation, write large context once and point subagents at the file:

```ts
write(".beads/artifacts/<id>/worker-context.md", contextContent)
Agent({ prompt: "Read worker-context.md and implement task 3." })
```

Use when: shared context > ~500 tokens, multiple subagents need the same background, or plans/specs must be passed without duplication.
