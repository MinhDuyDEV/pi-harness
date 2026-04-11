# Multi-Agent Coordination (Swarm Mode)

For parallel execution with multiple subagents, use the **swarm-coordination** skill:

```typescript
skill({ name: "swarm-coordination" });
```

**swarm-coordination** provides (via unified `swarm` tool):

- `swarm({ operation: "sync" })` - Sync Beads tasks to OpenCode todos for subagent visibility
- `swarm({ operation: "monitor" })` - Real-time progress tracking and visualization
- `swarm({ operation: "plan" })` - Task classification and dependency analysis
- `swarm({ operation: "delegate" })` - Create delegation packets for workers

**When to use beads vs swarm-coordination:**

| Scenario                       | Use                                    |
| ------------------------------ | -------------------------------------- |
| Single agent, linear work      | `beads` skill only                     |
| Multiple agents in parallel    | `swarm-coordination` + `beads`         |
| Need subagents to see tasks    | `swarm-coordination` (swarm sync push) |
| Track worker progress visually | `swarm-coordination` (swarm monitor)   |

**Example swarm workflow:**

```typescript
// 1. Push beads to OpenCode todos (subagents can see via todoread)
swarm({ operation: "sync", action: "push" });

// 2. Spawn workers in parallel using Task tool
Task({ subagent_type: "worker", description: "Worker 1", prompt: "..." });
Task({ subagent_type: "worker", description: "Worker 2", prompt: "..." });

// 3. Monitor progress
swarm({ operation: "monitor", action: "render_block", team_name: "my-swarm" });

// 4. Pull completed work back to beads
swarm({ operation: "sync", action: "pull" });
```
