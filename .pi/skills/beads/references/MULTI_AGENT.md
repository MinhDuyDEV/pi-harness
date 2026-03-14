# Multi-Agent Coordination (Swarm Mode)

For parallel execution with multiple subagents, use the **beads-bridge** skill:

```typescript
skill({ name: "beads-bridge" });
```

**beads-bridge** provides (via unified `swarm` tool):

- `swarm({ operation: "sync" })` - Sync Beads tasks to OpenCode todos for subagent visibility
- `swarm({ operation: "monitor" })` - Real-time progress tracking and visualization
- `swarm({ operation: "plan" })` - Task classification and dependency analysis
- `swarm({ operation: "delegate" })` - Create delegation packets for workers

**When to use beads vs beads-bridge:**

| Scenario                       | Use                              |
| ------------------------------ | -------------------------------- |
| Single agent, linear work      | `beads` skill only               |
| Multiple agents in parallel    | `beads-bridge` + `beads`         |
| Need subagents to see tasks    | `beads-bridge` (swarm sync push) |
| Track worker progress visually | `beads-bridge` (swarm monitor)   |

**Example swarm workflow:**

```typescript
// 1. Push beads to OpenCode todos (subagents can see via todoread)
swarm({ operation: "sync", action: "push" });

// 2. Spawn workers in parallel using Task tool
Task({ subagent_type: "general", description: "Worker 1", prompt: "..." });
Task({ subagent_type: "general", description: "Worker 2", prompt: "..." });

// 3. Monitor progress
swarm({ operation: "monitor", action: "render_block", team_name: "my-swarm" });

// 4. Pull completed work back to beads
swarm({ operation: "sync", action: "pull" });
```
