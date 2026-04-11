---
name: swarm-coordination
description: >
  Use when implementing plans with multiple independent tasks that can run in parallel.
  Enables leader agents to spawn, coordinate, and monitor worker swarms using Kimi K2.5 PARL patterns.
  Covers task classification, anti-serial-collapse detection, delegation packets, progress tracking,
  and graceful shutdown patterns.
version: "2.1.0"
license: MIT
tags: [agent-coordination, workflow]
dependencies: [beads]
---

# Swarm Coordination - Kimi K2.5 PARL Multi-Agent Execution

> **Replaces** manual task-by-task execution of large plans — sequential bottleneck when tasks have no dependencies

## When to Use

- Implementing plans with 3+ independent tasks that can run in parallel
- You need structured coordination, monitoring, and delegation across many agents

## When NOT to Use

- Single-task or tightly sequential work without parallelizable groups
- Simple 1–2 file changes better handled by a single agent

## Overview

**Swarm = Leader + Workers + Reconciler + Progress Tracking + Todo Persistence**

- **Leader (build agent)**: Orchestrates the swarm - analyzes tasks, spawns workers, monitors progress, synthesizes results
- **Workers (general/explore/review/plan agents)**: Execute independent tasks - read delegation, make changes, report progress
- **Reconciler**: Watches for CI failures, detects broken builds, auto-spawns fix tasks - this is the self-healing mechanism
- **Progress Tracker (swarm-progress.jsonl)**: Real-time progress updates with TUI visualization
- **Todo Persistence (swarm-todos.json)**: Cross-session recovery for interrupted swarms

**Key Tools**:

| Tool    | Purpose                    | When to Use          |
| ------- | -------------------------- | -------------------- |
| `swarm` | Unified swarm coordination | All swarm operations |

**swarm operations:**

- `plan`: Task classification & dependency graph (before spawning workers)
- `delegate`: Create delegation packets (assigning work to workers)
- `monitor`: Progress tracking + TUI visualization (during swarm execution)
- `sync`: Sync Beads ↔ OpenCode todos (session start, cross-session)

**Key Distinction**:

- **Swarm**: Parallel execution of independent tasks with dynamic allocation
- **Beads**: Task tracking and dependency management across sessions
- **Task tool**: Spawning individual subagents for research/execution
- **swarm tool**: Unified operations for planning, monitoring, delegation, and sync

**When to Use Swarm Coordination**:

- "Does this plan have 3+ independent tasks?" → **YES** = Swarm
- "Can multiple tasks run in parallel without conflicts?" → **YES** = Swarm
- "Do I need to coordinate multiple agents?" → **YES** = Swarm
- "Is this a single task or sequential dependency chain?" → **NO** = Single agent

**Kimi K2.5 PARL Patterns**:

- **Task Classification**: Auto-detect parallelization potential
- **Anti-Serial-Collapse**: Prevent forced sequential execution
- **Dynamic Allocation**: Conservative start, scale based on bottlenecks
- **Progress Visualization**: Real-time TUI with beautiful markdown blocks
- **Dependency Graphs**: DAG-based task scheduling with critical path analysis

## When to Use Swarm vs Single Agent

| Scenario                      | Approach     |
| ----------------------------- | ------------ |
| 1-2 file changes              | Single agent |
| Sequential dependencies       | Single agent |
| 3+ independent parallel tasks | Swarm        |
| Cross-domain work (FE/BE/DB)  | Swarm        |
| Time-sensitive parallel work  | Swarm        |

## Quick Reference - Kimi K2.5 PARL Pattern

```
SWARM LAUNCH (PARL):
  0. SETUP: swarm({ operation: "sync", action: "push" })
     → Make Beads visible to subagents
  1. ANALYZE: swarm({ operation: "plan", action: "analyze", task: userRequest, files: detectedFiles })
     → Get classification, phases, dependency_graph
  2. CHECK: swarm({ operation: "plan", action: "check", ... })
     → Detect/prevent serial collapse
  3. DELEGATE: swarm({ operation: "delegate", ... })
     → Create packets for each worker
  4. SPAWN: Task({ subagent_type: "worker" })
     → Launch workers using parallelizable_groups order
  5. MONITOR: swarm({ operation: "monitor", action: "render_block" })
     → Real-time TUI progress
  6. VERIFY: npm run typecheck && npm run lint && npm test
  7. CLOSE: swarm({ operation: "sync", action: "pull" }) && br close <bead>

WORKER EXECUTION:
  1. Read delegation packet
  2. Report START: swarm({ operation: "monitor", action: "progress_update", progress: 0, status: "working" })
  3. Execute with constraints
  4. Report PROGRESS (every 25%): swarm({ operation: "monitor", action: "progress_update", progress: 25/50/75 })
  5. Run acceptance checks
  6. Report DONE: swarm({ operation: "monitor", action: "progress_update", progress: 100, status: "completed" })

COORDINATION:
  - Progress: .beads/swarm-progress.jsonl (via swarm monitor)
  - Delegation: .beads/artifacts/<id>/delegation.md (via swarm delegate)
  - Analysis: swarm tool for classification + dependency graphs

RECOVERY:
  - Check: swarm({ operation: "monitor", action: "status" })
  - Use shared task lists: swarm({ operation: "sync", action: "create_shared" })
  - Continue with remaining workers

SHUTDOWN:
  - All workers done → swarm({ operation: "monitor", action: "clear" })
  - Run full test suite
  - swarm({ operation: "sync", action: "pull" })
  - Close parent bead
```

## Tools Reference

| Tool      | Purpose                    | Key Operations                        |
| --------- | -------------------------- | ------------------------------------- |
| **swarm** | Unified swarm coordination | `plan`, `monitor`, `delegate`, `sync` |

**swarm operations:**

- `plan`: Task analysis + dependency DAG (actions: analyze, classify, check, allocate)
- `delegate`: Create delegation packets
- `monitor`: Progress tracking + visualization (actions: progress_update, render_block, status, clear)
- `sync`: Beads ↔ OpenCode todos (actions: push, pull, create_shared, get_shared, update_shared, list_shared)

## Beads Integration

### Session Start: Load Beads into Todos

Make Beads tasks visible to subagents:

```typescript
// Push Beads to OpenCode todos
const result = await swarm({
  operation: "sync",
  action: "push",
  filter: "open", // or "in_progress", "all"
});
```

### Session End: Sync Back to Beads

```typescript
// Pull completed todos back to Beads
await swarm({ operation: "sync", action: "pull" });

// Clear swarm state
await swarm({
  operation: "monitor",
  action: "clear",
  team_name: "api-refactor-swarm",
});

// Sync and commit
await bash("br sync --flush-only");
await bash("git add .beads/ && git commit -m 'close swarm'");
```

### Cross-Session Handoff

For work spanning multiple sessions, use shared task lists:

```typescript
// Create shared list
const list = await swarm({
  operation: "sync",
  action: "create_shared",
  name: "api-refactor-swarm",
  tasks: JSON.stringify([
    { id: "task-1", content: "Refactor auth", status: "pending", priority: "high" },
  ]),
});

// Resume in new session
const shared = await swarm({
  operation: "sync",
  action: "get_shared",
  list_id: "api-refactor-swarm",
});
```

### Data Locations

| Data Type         | Location                                        | Persistence   |
| ----------------- | ----------------------------------------------- | ------------- |
| Beads tasks       | `.beads/issues/*.md`                            | Git-backed    |
| Swarm progress    | `.beads/swarm-progress.jsonl`                   | Session       |
| Shared task lists | `~/.local/share/opencode/storage/shared-tasks/` | Cross-session |
| OpenCode todos    | `~/.local/share/opencode/storage/todo/`         | Session       |

## Rules

1. **Leader spawns, workers execute** - Clear role separation
2. **Delegation packets are contracts** - Workers follow them strictly
3. **Progress tracking for coordination** - All status via swarm monitor progress updates
4. **Non-overlapping assignments** - Ensure workers edit different files
5. **Acceptance checks required** - Workers verify before reporting done
6. **Persist periodically** - Enable cross-session recovery
7. **Use dependency graph** - Spawn workers in parallelizable_groups order
8. **Graceful shutdown** - Leader waits for all workers, syncs back to Beads
9. **Use tmux for visibility** - Enable visual monitoring when available
10. **Use reconciler at scale** - Required for 50+ agents, recommended for 10+
11. **Reconciler watches continuously** - Spawns fix tasks on detected failures

## Anti-Patterns

| Anti-Pattern                                            | Why It Fails                                               | Instead                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Spawning agents for tasks with shared file dependencies | Workers block or overwrite each other, causing merge churn | Partition work by non-overlapping files/modules first             |
| Not tracking agent completion status                    | Leader loses visibility; work appears done when it is not  | Require `monitor.progress_update` lifecycle (start/progress/done) |
| Dispatching without pre-computed dependency graph       | Tasks run out of order, causing rework and serial fallback | Run `swarm plan` first and dispatch by `parallelizable_groups`    |
| Using swarm for < 3 tasks (overhead not worth it)       | Coordination overhead exceeds execution savings            | Use a single agent or 2 direct `Task()` calls                     |

## References

- `references/architecture.md` - Swarm architecture diagram
- `references/reconciler.md` - Reconciler pattern, error analysis, and fix task spawning
- `references/drift-check.md` - Drift checks after each wave and recovery protocol
- `references/launch-flow.md` - PARL swarm launch flow with step-by-step code
- `references/dependency-graph.md` - Dependency graph structures and usage
- `references/delegation-worker-protocol.md` - Delegation packet structure, worker protocol, and error handling
- `references/integration-beads.md` - Swarm integration workflow with Beads
- `references/tmux-integration.md` - Tmux monitoring setup and commands
- `references/tier-enforcement.md` - Tier enforcement (Longshot pattern)

## See Also

- `agent-teams` — for coordinated multi-role collaboration beyond large plan execution
- `dispatching-parallel-agents` — for lightweight parallel debugging of independent failures
- `executing-plans` — for plan-driven execution when parallelism is moderate or bounded
