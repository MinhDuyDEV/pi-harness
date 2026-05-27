# Delegation — Two-Layer Model

## Layer 1: Subagents

### Pi Native Tools (from pi-coding-agent)

| Tool | Purpose |
|---|---|
| `Agent` | Spawn a specialized agent (foreground or background) |
| `get_subagent_result` | Fetch output from a background agent |
| `steer_subagent` | Redirect a running background agent |

### pikit-subagents Extension Tools (custom built-in)

| Tool | Purpose |
|---|---|
| `agent_spawn` | Spawn sub-agents with tool allowlisting, depth tracking, model routing |
| `agent_result` | Collect results from background/blocking sub-agents |
| `agent_list` | List all sub-agents with status, depth, duration |
| `agent_stop` | Abort running sub-agents |
| `agent_steer` | Send steering messages to running sub-agents |
| `agent_depth` | Check delegation depth hierarchy |

**Use for:** quick tasks, single-shot delegation, and parallel batches. The pikit-subagents extension provides depth-aware delegation (max 3 levels) and tool allowlisting for security.

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

## Auto-Delegation (Intent Mapping)

| When user asks... | Use |
|---|---|
| research / investigate / compare / what is / how does / look up | `scout` |
| find code / trace usage / locate / where is / search code | `explore` |
| review / check for bugs / audit / is this correct / does this work | `reviewer` |
| plan / design / architecture / how should I / outline | `planner` |
| inspect UI / screenshot / visual / accessibility / design review | `vision` |
| small implementation / fix / add / modify / update | `worker` |
| anything else | do it yourself |

## Orchestrator Self-Delegation Rules

**Core principle:** Every tool call the orchestrator makes burns shared context. Subagents have fresh dedicated context. Delegate when the work doesn't need conversation history.

### DELEGATE when:
- Task requires **3+ tool calls** (search, fetch, read, grep, etc.)
- Task is **independent of conversation context** (doesn't need prior messages)
- Task matches a specialist role (scout, explore, reviewer, planner, vision, worker)
- Task involves **web research** (websearch, web_fetch, webclaw)
- Task involves **multi-file exploration** (find, grep across codebase)
- Task is a **defined unit of work** with clear output (compare X vs Y, review file Z)

### DO IT YOURSELF when:
- **1-2 tool calls** (trivial lookup, single grep, read one file)
- Task **requires conversation context** (follow-up questions, building on prior discussion)
- Task is **ambiguous** and needs clarification before acting
- Task is a **tight follow-up** where the orchestrator already has the context
- Task is **tool-call routing** (deciding which agent gets what)

### The 3-Call Rule

If you predict the task needs **3 or more tool calls**, delegate it. Period.

```
1-2 calls → do it yourself (fast, no overhead)
3+ calls  → delegate (saves orchestrator context, parallel execution)
```

### Context Cost Comparison

| Approach | Orchestrator tokens | Subagent tokens | Total |
|----------|--------------------:|----------------:|------:|
| Do 15 tool calls yourself | ~75K | 0 | 75K |
| Delegate to scout | ~2K | ~50K (isolated) | ~52K |
| **Savings** | **73K** | | **31%** |

Subagent context doesn't compete with orchestrator context. The orchestrator stays clean for user interaction.

### Parallel Delegation

When multiple independent tasks exist, launch them in parallel:

```
Agent({ prompt: "Research X", subagent_type: "scout", run_in_background: true })
Agent({ prompt: "Explore codebase for Y", subagent_type: "explore", run_in_background: true })
// Continue conversation while agents work
// get_subagent_result(agent_id, wait: true) when you need the output
```

Or use the pikit-subagents extension for depth-aware delegation:

```
agent_spawn({ task: "Research X", type: "scout", mode: "background" })
agent_spawn({ task: "Explore codebase for Y", type: "explore", mode: "background" })
agent_result({ agentId: "sa-1" })
agent_list({})
agent_steer({ agentId: "sa-1", message: "Focus on pricing" })
agent_stop({ agentId: "sa-1" })
agent_depth({})
```

This is **always faster** than sequential execution.

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
