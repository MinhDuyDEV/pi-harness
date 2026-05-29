# Delegation — Three-Layer Model

## CRITICAL RULE: Always use `harness` for any create/build/make/generate

Any time the user says **create**, **build**, **make**, **generate**, or asks for new code to be written —
**you MUST use the `harness` tool.** Do NOT use `write`, `edit`, or `bash` to create files directly.

The harness tool runs a planner → generator pipeline that ensures proper specs, implementation,
and optional QA. Even for single-file tasks.

**Exception:** Only use `write`/`edit`/`bash` directly for fixes, modifications, or edits to
_existing_ code. Never for new code.

```
User says "create X"    → harness
User says "build X"     → harness
User says "make X"      → harness
User says "fix X"       → direct tools (edit/write)
User says "update X"    → direct tools (edit/write)
```

## Layer 0: Build Harness (product-level)

| Tool      | Purpose                                                          |
| --------- | ---------------------------------------------------------------- |
| `harness` | Multi-agent build pipeline: planner → generator → evaluator loop |

**Use for:** building complete applications from a short product prompt (1-4 sentences).
The harness decomposes work into sprints, implements them with automated QA.

### Pattern Selection

| Pattern                       | When                                  | Behavior                                                              |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| `producer-reviewer` (default) | Need automated QA per sprint          | Generator builds → Evaluator tests → Fix if FAIL → up to N iterations |
| `pipeline`                    | Simple sequential build, no QA needed | Generator builds each sprint, no evaluation loop                      |

**Use producer-reviewer when:** correctness matters, you want automated testing of each feature.
**Use pipeline when:** the task is well-understood and fast execution matters more than verification.

### When to Use Harness vs Agent (Layer 1)

| Situation                                                           | Use                                                        |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| User says "build", "create", or "make" ANYTHING — even single files | `harness` (default — planner decomposes, generator builds) |
| Research / explore / review existing code                           | `Agent` (scout/explore/reviewer)                           |
| Small implementation (1-3 files)                                    | `Agent` (worker) or direct tools                           |
| Complex build with multi-step orchestration                         | `harness` (producer-reviewer)                              |
| Multi-session / long-running builds                                 | `harness` (handles context per agent session)              |

**Rule of thumb:** Any time the user says "create", "build", "make", "generate" → `harness`.
Reserve `Agent(worker)` only when the task is an explicit fix or small edit to existing code.

## Layer 1: Subagents (task-level)

### Pi Native Tools (from pi-coding-agent)

| Tool                  | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `Agent`               | Spawn a specialized agent (foreground or background) |
| `get_subagent_result` | Fetch output from a background agent                 |
| `steer_subagent`      | Redirect a running background agent                  |

**Use for:** quick tasks, single-shot delegation, and parallel batches.

## Layer 2: Task Orchestration (process-level)

| Tool          | Purpose                                      |
| ------------- | -------------------------------------------- |
| `TaskCreate`  | Create a task (optionally with `agentType`)  |
| `TaskList`    | List tasks and blockers                      |
| `TaskGet`     | Read full task details                       |
| `TaskUpdate`  | Update status/owner/dependencies             |
| `TaskExecute` | Execute agent-backed tasks                   |
| `TaskOutput`  | Retrieve output from running/completed tasks |
| `TaskStop`    | Stop a running task                          |

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

| When user asks...                                                  | Use                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| build / create / make any code artifact or project                 | `harness` (always — planner specs the work, generator builds) |
| research / investigate / compare / what is / how does / look up    | `scout`                                                       |
| find code / trace usage / locate / where is / search code          | `explore`                                                     |
| review / check for bugs / audit / is this correct / does this work | `reviewer`                                                    |
| plan / design / architecture / how should I / outline              | `planner`                                                     |
| inspect UI / screenshot / visual / accessibility / design review   | `vision`                                                      |
| small implementation / fix / add / modify / update                 | `worker`                                                      |
| anything else                                                      | do it yourself                                                |

## Orchestrator Self-Delegation Rules

**Core principle:** Every tool call the orchestrator makes burns shared context. Subagents have fresh dedicated context. Delegate when the work doesn't need conversation history.

### DELEGATE when:

- User says **build, create, or make** anything → `harness` (planners specs → generator builds)
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

| Approach                  | Orchestrator tokens | Subagent tokens |   Total |
| ------------------------- | ------------------: | --------------: | ------: |
| Do 15 tool calls yourself |                ~75K |               0 |     75K |
| Delegate to scout         |                 ~2K | ~50K (isolated) |    ~52K |
| **Savings**               |             **73K** |                 | **31%** |

Subagent context doesn't compete with orchestrator context. The orchestrator stays clean for user interaction.

### Parallel Delegation

When multiple independent tasks exist, launch them in parallel:

```ts
Agent({
  prompt: "Research X",
  subagent_type: "scout",
  run_in_background: true,
});
Agent({
  prompt: "Explore codebase for Y",
  subagent_type: "explore",
  run_in_background: true,
});
// Continue conversation while agents work
// get_subagent_result(agent_id, wait: true) when you need the output
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
write(".beads/artifacts/<id>/worker-context.md", contextContent);
Agent({ prompt: "Read worker-context.md and implement task 3." });
```

Use when: shared context > ~500 tokens, multiple subagents need the same background, or plans/specs must be passed without duplication.
