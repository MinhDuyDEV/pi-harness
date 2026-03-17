# Delegation — Three-Layer Model

Three integrated systems for delegating work, each optimized for different scales:

```
Layer 1: @tintinweb/pi-subagents  →  Fast in-process agents (seconds to minutes)
Layer 2: @tintinweb/pi-tasks      →  DAG orchestration + auto-cascade execution
Layer 3: pi-teams                  →  Multi-process coordination (full context per agent)
```

## Layer 1: Subagents (`@tintinweb/pi-subagents`)

Lightweight in-process delegation. Results flow back into conversation. Queue-based concurrency (4 concurrent default).

| Tool | Purpose |
|---|---|
| `Agent` | Spawn a specialized agent (foreground or background) |
| `get_subagent_result` | Fetch output from a background agent (wait or poll) |
| `steer_subagent` | Send mid-run message to redirect a running agent |

**Key features:**
- Smart batching: 2+ background agents spawned in same turn → grouped notification
- Resume support: continue agent from previous conversation via `resume: agentId`
- Worktree isolation: `isolation: "worktree"` for safe parallel file modifications
- Custom agent types from `.pi/agents/*.md`

**When to use:** Quick tasks, single-shot delegation, parallel batches under 5 minutes each.

```
Agent(type: "explore", prompt: "find all API routes", run_in_background: true)
Agent(type: "worker", prompt: "fix login validation bug")
```

## Layer 2: Task Orchestration (`@tintinweb/pi-tasks`)

DAG-based task management with dependency tracking and auto-cascade execution.

| Tool | Purpose |
|---|---|
| `TaskCreate` | Create a task with subject/description (optionally `agentType` for auto-execution) |
| `TaskList` | List all tasks with status and blockers |
| `TaskGet` | Read full task details including dependencies |
| `TaskUpdate` | Update status/owner/metadata/dependencies (`addBlocks`/`addBlockedBy`) |
| `TaskExecute` | Execute agent-typed tasks as subagents (auto-cascades unblocked dependents) |
| `TaskOutput` | Retrieve output from running/completed task |
| `TaskStop` | Stop a running background task |

**Statuses:** `pending` → `in_progress` → `completed` (`deleted` for removal)

**Key features:**
- **DAG dependencies**: `addBlockedBy: ["1"]` — task won't start until blockers complete
- **Auto-cascade**: `TaskExecute` completes task #1 → auto-spawns unblocked task #2
- **Agent coupling**: Tasks with `agentType` (e.g. `"explore"`, `"worker"`) are executable via `TaskExecute`
- **Dual storage**: In-memory (session) or file-backed (`~/.pi/tasks/`) with file locking

**When to use:** Multi-step work with dependencies, pipelines where order matters, tracking progress across complex features.

```
TaskCreate(subject: "Research auth patterns", agentType: "scout")           → #1
TaskCreate(subject: "Plan implementation", agentType: "planner")            → #2
TaskCreate(subject: "Implement auth module", agentType: "worker")           → #3
TaskUpdate(taskId: "2", addBlockedBy: ["1"])
TaskUpdate(taskId: "3", addBlockedBy: ["2"])
TaskExecute(task_ids: ["1"])  → completes → auto-cascades #2 → auto-cascades #3
```

**Manual tracking (no auto-execution):**
1. `TaskCreate` tasks with clear subject + detailed description (no `agentType`)
2. `TaskUpdate` status as you work (`pending` → `in_progress` → `completed`)
3. `TaskList` after each completion to pick next available work

## Layer 3: Teams (`pi-teams`)

Separate Pi processes in tmux panes. Each teammate gets its own **full context window**, task board, and messaging. Requires tmux session.

| Tool | Purpose |
|---|---|
| `team_create` | Create a new team (sets up coordination directory) |
| `spawn_teammate` | Launch agent in tmux pane with role prompt |
| `send_message` | Send message to specific teammate |
| `broadcast_message` | Send message to all teammates |
| `read_inbox` | Check messages from teammates |
| `check_teammate` | Verify agent is alive |
| `task_create` (team) | Create task on shared team board |
| `task_submit_plan` | Teammate submits implementation plan |
| `task_evaluate_plan` | Lead approves/rejects submitted plan |
| `task_update` (team) | Update team task status/owner |
| `task_list` (team) | List team tasks |
| `team_shutdown` | Clean up all panes and coordination files |

**Key features:**
- Multi-process isolation: each teammate can't crash parent, gets full context budget
- File-based coordination: `~/.pi/teams/<name>/` (config, tasks, inboxes, PIDs)
- Plan approval mode: `plan_mode_required: true` → governance before code changes
- Visual oversight: human can watch agent work in real-time via tmux

**When to use:** Long-running parallel work (15+ min each), multiple specialists needing deep context, human oversight required.

```
team_create("auth-migration")
spawn_teammate("auth-migration", "researcher", "Research OAuth2 patterns", cwd: ".")
spawn_teammate("auth-migration", "implementer", "Implement auth after research", cwd: ".")
send_message("auth-migration", "researcher", "Focus on PKCE flow specifically")
read_inbox("auth-migration")  → check teammate reports
team_shutdown("auth-migration")
```

## Decision Flowchart

```
Is it < 3 independent tasks?
  YES → Agent (direct or background)
  NO ↓

Do tasks have dependencies (A must finish before B)?
  YES → TaskCreate + TaskExecute (DAG auto-cascade)
  NO ↓

Do tasks need sustained context (> 15 min each)?
  YES → pi-teams (separate processes, full context window)
  NO → Agent with run_in_background (parallel batch)

Need human approval before code changes?
  YES → pi-teams with plan_mode_required: true
```

## Combo Patterns

**Pattern 1: Quick Parallel** — Use `Agent` directly, no tasks needed.
```
Agent(type: "explore", prompt: "find all API routes", run_in_background: true)
Agent(type: "explore", prompt: "find all middleware", run_in_background: true)
→ grouped notification when all complete
```

**Pattern 2: Dependency Chain** — Use `pi-tasks` for DAG + auto-cascade.
```
TaskCreate(#1: "Research", agentType: "scout")
TaskCreate(#2: "Plan", agentType: "planner", blockedBy: [#1])
TaskCreate(#3: "Implement", agentType: "worker", blockedBy: [#2])
TaskExecute([#1])  → auto-cascades through #2 → #3
```

**Pattern 3: Big Feature** — Use `pi-teams` for sustained parallel work.
```
team_create("feature-x")
spawn_teammate("feature-x", "researcher", "Deep research on X")
spawn_teammate("feature-x", "implementer", "Build X after research")
spawn_teammate("feature-x", "tester", "Write tests for X")
→ each has full context window, coordinate via messages
```

**Pattern 4: Hybrid** — Tasks for tracking, subagents for execution.
```
TaskCreate(#1: "Fix auth bug", agentType: "worker")
TaskCreate(#2: "Fix payment bug", agentType: "worker")
TaskCreate(#3: "Run full test suite")  ← manual, no agentType
TaskUpdate(#3, addBlockedBy: ["1", "2"])
TaskExecute(["1", "2"])  → parallel workers → when both done, you run #3 manually
```

## Agent Roster

| Agent | Use For | Key Traits |
|---|---|---|
| `worker` | Small implementation tasks (1-3 files) | Auto-fix deviation rules, TDD support |
| `explore` | Codebase search and pattern discovery | Read-only, AST-aware, thoroughness levels |
| `scout` | External docs/research | Memory-first, source quality hierarchy, cited |
| `reviewer` | Code review, debugging, security | Read-only, P0-P3 severity, stub detection |
| `planner` | Architecture and execution plans | Goal-backward, dependency graphs, context budget |
| `vision` | UI/UX and accessibility analysis | Read-only, WCAG-focused, design-system audit |
| `painter` | Image generation/editing | Metadata contract, iterative edits |

## Auto-Delegation Rules (MANDATORY)

**You MUST delegate to the appropriate subagent when the task matches their specialty.** Do not do the work yourself when a specialist exists. This saves your context window and produces better results.

| User asks... | You MUST delegate to | How |
|---|---|---|
| "research X", "look into X", "what is X" | `scout` | `Agent(type: "scout", prompt: "...")` |
| "find X in codebase", "where is X used" | `explore` | `Agent(type: "explore", prompt: "...")` |
| "review this code", "check for bugs" | `reviewer` | `Agent(type: "reviewer", prompt: "...")` |
| "plan how to implement X" | `planner` | `Agent(type: "planner", prompt: "...")` |
| "check this UI/design/screenshot" | `vision` | `Agent(type: "vision", prompt: "...")` |
| "generate an image" | `painter` | `Agent(type: "painter", prompt: "...")` |
| Small implementation (1-3 files) | `worker` | `Agent(type: "worker", prompt: "...")` |

**Exceptions** (do it yourself):
- Trivial lookups that take one tool call (e.g., reading a single file)
- Follow-up questions in an active conversation where you already have context
- Tasks that require your accumulated conversation context to answer

**Compound tasks** — break them up:
- Research then implement → `Agent(scout)` → wait → `Agent(worker)`
- Research then plan → `Agent(scout)` → wait → `Agent(planner)`
- Multiple independent searches → 3x `Agent(explore, background: true)`
- Complex pipeline → `TaskCreate` chain with `agentType` + `TaskExecute`
