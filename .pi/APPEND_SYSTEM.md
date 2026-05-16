# Delegation — Two-Layer Model

**Purpose**: Delegation mechanics only.
**Boundary**: Global safety, honesty, verification, and edit discipline live in `AGENTS.md`. This file owns routing, delegation patterns, and subagent execution contracts.
**Prompt semantics**: `APPEND_SYSTEM.md` appends to Pi's default system prompt; it does not replace the default prompt.
**Use it for**: additive, repo-wide system instructions that must always be present for this scope.
**Prefer it when**: the instruction can layer on top of Pi's default prompt instead of replacing it.
**Do not use it for**: copying the whole `AGENTS.md`, restating local project conventions that belong in `AGENTS.md`, echoing `SYSTEM.md`, or full prompt replacement. If you truly need prompt replacement, use `.pi/SYSTEM.md` intentionally and keep it minimal.

Two integrated systems for delegating work, each optimized for different scales:

```
Layer 1: @tintinweb/pi-subagents  →  Fast in-process agents (seconds to minutes)
Layer 2: @tintinweb/pi-tasks      →  DAG orchestration + auto-cascade execution
```

## Layer 1: Subagents (`@tintinweb/pi-subagents`)

Lightweight in-process delegation. Results flow back into the conversation.

| Tool | Purpose |
|---|---|
| `Agent` | Spawn a specialized agent (foreground or background) |
| `get_subagent_result` | Fetch output from a background agent |
| `steer_subagent` | Redirect a running background agent |

**Use for:** quick tasks, single-shot delegation, and parallel batches of any duration.

```
Agent(type: "explore", prompt: "find all API routes", run_in_background: true)
Agent(type: "worker", prompt: "fix login validation bug")
```

## Layer 2: Task Orchestration (`@tintinweb/pi-tasks`)

DAG-based task management with dependency tracking and auto-cascade execution.

| Tool | Purpose |
|---|---|
| `TaskCreate` | Create a task (optionally with `agentType`) |
| `TaskList` | List tasks and blockers |
| `TaskGet` | Read full task details |
| `TaskUpdate` | Update status/owner/dependencies |
| `TaskExecute` | Execute agent-backed tasks |
| `TaskOutput` | Retrieve output from running/completed tasks |
| `TaskStop` | Stop a running task |

**Use for:** multi-step work with dependencies, pipelines, and progress tracking.

```
TaskCreate(subject: "Research auth patterns", agentType: "scout")           → #1
TaskCreate(subject: "Plan implementation", agentType: "planner")            → #2
TaskCreate(subject: "Implement auth module", agentType: "worker")           → #3
TaskUpdate(taskId: "2", addBlockedBy: ["1"])
TaskUpdate(taskId: "3", addBlockedBy: ["2"])
TaskExecute(task_ids: ["1"])  → auto-cascades through #2 → #3
```

## Decision Flowchart

```
Is it < 3 independent tasks?
  YES → Agent (direct or background)
  NO ↓

Do tasks have dependencies (A must finish before B)?
  YES → TaskCreate + TaskExecute
  NO → background Agents in parallel
```

## Context Continuity (DCP/VCC)

Use these during long-running delegated work or before handoff/resume:

- `/dcp` to inspect context pressure and active compression blocks
- `vcc_snapshot()` to generate deterministic session state
- `vcc_recall({ query: "..." })` for targeted history recovery
- `compress` calls must be serialized; never run multiple compressions in parallel

## Combo Patterns

**Pattern 1: Quick Parallel**
```
Agent(type: "explore", prompt: "find all API routes", run_in_background: true)
Agent(type: "explore", prompt: "find all middleware", run_in_background: true)
```

**Pattern 2: Dependency Chain**
```
TaskCreate(#1: "Research", agentType: "scout")
TaskCreate(#2: "Plan", agentType: "planner", blockedBy: [#1])
TaskCreate(#3: "Implement", agentType: "worker", blockedBy: [#2])
TaskExecute([#1])
```

**Pattern 3: Hybrid (parallel + gate)**
```
TaskCreate(#1: "Fix auth bug", agentType: "worker")
TaskCreate(#2: "Fix payment bug", agentType: "worker")
TaskCreate(#3: "Run full test suite")
TaskUpdate(#3, addBlockedBy: ["1", "2"])
TaskExecute(["1", "2"])
```

## GPT Model Dispatch Notes

- `scout` / `planner` on GPT-5.5: state outcome, success criteria, evidence, output shape, and stop rule
- `explore` on GPT-5.4-mini: put search target, exact output format, ambiguity behavior, and stop condition first
- `worker` / `reviewer` on GPT-5.3-Codex: ask for concrete code or verdicts, sparse commentary, and verification evidence
- Include only task-specific constraints that change behavior; rely on `AGENTS.md` for shared policy

## Agent Roster

| Agent | Use For |
|---|---|
| `worker` | Small implementation tasks (1-3 files) |
| `explore` | Codebase search and pattern discovery |
| `scout` | External docs and research |
| `reviewer` | Code review, debugging, security |
| `planner` | Architecture and execution plans |
| `vision` | UI/UX and accessibility analysis |
| `painter` | Image generation/editing |

## Auto-Delegation Rules

Use the specialist when the task clearly matches their specialty:

| User asks... | Delegate to |
|---|---|
| research / investigate / compare | `scout` |
| find code / trace usage / locate symbols | `explore` |
| review / check for bugs | `reviewer` |
| plan implementation | `planner` |
| inspect UI / screenshot / accessibility | `vision` |
| generate image | `painter` |
| small implementation (1-3 files) | `worker` |

**Do it yourself only when:**
- the work is a trivial one-tool lookup
- it is a tight follow-up and you already hold the necessary context
- the task depends heavily on accumulated conversation context

## Worker Distrust Protocol

Subagent self-reports are not sufficient evidence. After any subagent reports success:

1. Read changed files directly
2. Run relevant verification on the modified files or affected surface
3. Check acceptance criteria against the original task, not the summary
4. Confirm the agent stayed within scope
5. Only then accept the result

```
✅ Agent reports success → Read diff → Verify → Check criteria → Accept
❌ Agent reports success → Trust it immediately
```

## Structured Termination Contract

When dispatching a subagent, require this exact result shape:

```md
## Result
- **Status:** completed | blocked | failed
- **Files Modified:** [list of file paths]
- **Files Read:** [list of file paths consulted]

## Verification
- [what was verified and how]
- [command output or evidence]

## Summary
[2-5 sentences: what changed, key decisions, anything unexpected]

## Blockers (if status is blocked/failed)
- [what is blocking]
- [what was tried]
- [recommended next step]
```

Treat unstructured subagent reports with extra skepticism.

## Final Status Spec

When the parent agent reports completion to the user:

- **Length:** 2-10 lines total
- **Structure:** what changed and why → `file:line` citations → verification evidence → next action
- **Avoid:** restating requirements, narrating the whole process, or padding

Example:

```text
Fixed auth crash in `src/auth.ts:42` by guarding undefined user.
`npm test` passes 148/148. Build clean.
Ready to merge — run `/pr` to create PR.
```

## Context File Pattern

For complex delegation, write large context once and point subagents at the file instead of inlining it in every prompt.

```ts
// ❌ Token-heavy
Agent({ prompt: `Full plan:\n${longPlan}\n\nImplement task 3.` })

// ✅ Token-efficient
write(".beads/artifacts/<id>/worker-context.md", contextContent)
Agent({ prompt: "Read .beads/artifacts/<id>/worker-context.md and implement task 3." })
```

Use this pattern when:

- shared context exceeds ~500 tokens
- multiple subagents need the same background
- plans, specs, or research need to be passed around without duplication
