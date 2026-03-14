# Swarm Launch Flow - PARL Pattern (7 Steps)

## Step 0: Task Analysis (Anti-Serial-Collapse + Dependency Graph)

Analyze the user's actual task to determine optimal swarm strategy:

```typescript
// 1. Classify the task and build dependency graph
const analysis = await swarm({
  operation: "plan",
  operation: "analyze",
  task: "<user's request from input>",
  files: "<detected files from glob/grep>",
});

// Returns:
// - type: "search" | "batch" | "writing" | "sequential" | "mixed"
// - recommended_agents: number
// - phases: [{ name, role, agent_count, dependencies }]
// - coupling: "high" | "medium" | "low"
// - confidence: "high" | "medium" | "low"
// - dependency_graph: { nodes, edges, critical_path, parallelizable_groups }

const plan = JSON.parse(analysis);

// 2. Check for serial collapse
const check = await swarm({
  operation: "plan",
  operation: "check",
  task: "<user's request>",
  files: String(plan.file_count),
  recommended_agents: plan.classification.recommended_agents,
});

// If serial collapse detected, force parallelization
if (check.serial_collapse_detected) {
  console.log(`⚠️ Serial collapse detected: ${check.warning_signs.join(", ")}`);
  console.log(`✓ Adjusting to ${check.suggested_agents} agents`);
}

// 3. Use dependency graph for spawn ordering
const { parallelizable_groups, critical_path } = plan.dependency_graph;
console.log(`Critical path: ${critical_path.join(" → ")}`);
console.log(`Parallel groups: ${parallelizable_groups.length}`);
```

## Step 1: Session Setup (Push Beads to Todos)

Make Beads tasks visible to subagents:

```typescript
// Push Beads to OpenCode todos (subagents see via todoread)
await swarm({ operation: "sync", operation: "push", filter: "open" });

// Check for existing swarm state
const status = await swarm({
  operation: "monitor",
  operation: "status",
  team_name: "plan-implementation",
});
const stats = JSON.parse(status).summary;

if (stats.total_workers > 0) {
  console.log(`Found existing swarm with ${stats.total_workers} workers`);
  // Render current progress
  const ui = await swarm({
    operation: "monitor",
    operation: "render_block",
    team_name: "plan-implementation",
  });
  console.log(ui);
}
```

## Step 2: Create Delegation Packets

For each task, create a delegation packet:

```typescript
swarm({
  operation: "delegate",
  bead_id: "task-1",
  title: "Implement auth service",
  expected_outcome: "Auth service with JWT tokens, tests pass",
  required_tools: "read, grep, lsp, edit, bash",
  must_do: "LSP before edits, run npm test after changes",
  must_not_do: "No new dependencies, don't edit config files",
  acceptance_checks: "typecheck: npm run typecheck, lint: npm run lint, test: npm test",
  context: "See .beads/artifacts/task-1/spec.md for requirements",
  write: true,
});
```

## Step 3: Spawn Worker Agents (Using Dependency Groups)

Use parallelizable_groups from dependency graph for proper ordering:

```typescript
// Spawn workers in dependency order
for (const group of plan.dependency_graph.parallelizable_groups) {
  // All tasks in this group can run in parallel
  const spawnPromises = group.map((taskId) => {
    const node = plan.dependency_graph.nodes.find((n) => n.id === taskId);
    return Task({
      subagent_type: "general",
      description: `Execute ${taskId}`,
      prompt: `Execute bead ${taskId}: ${node.content}

Read delegation packet at: .beads/artifacts/${taskId}/delegation.md

Files: ${node.assignedFiles.join(", ")}
Phase: ${node.phase}
Worker: ${node.worker}
Team: plan-implementation

Requirements:
1. Follow all MUST DO constraints
2. Avoid all MUST NOT DO items
3. Run acceptance checks before claiming done
4. Report progress via swarm monitor`,
    });
  });

  // Wait for parallel group to complete before starting next
  await Promise.all(spawnPromises);
}
```

## Step 4: Monitor Progress (Real-time TUI + Persistence)

Monitor with beautiful block UI, progress tracking, and auto-persistence:

```typescript
let allComplete = false;
while (!allComplete) {
  // Option A: Render beautiful TUI block
  const ui = await swarm({
    operation: "monitor",
    operation: "render_block",
    team_name: "plan-implementation",
  });
  console.log(ui); // Markdown block with tables, emojis, progress

  // Option B: Get detailed status
  const status = await swarm({
    operation: "monitor",
    operation: "status",
    team_name: "plan-implementation",
  });
  const stats = JSON.parse(status).summary;
  // Returns: total_workers, completed, working, errors, messages

  // Check completion
  allComplete = stats.completed === stats.total_workers;

  if (!allComplete) {
    // Wait before checking again
    await new Promise((r) => setTimeout(r, 2000)); // Wait 2s
  }
}
```

## Step 5: Synthesize Results

When all workers complete:

```typescript
// 1. Get final status
const finalStatus = await swarm({
  operation: "monitor",
  operation: "status",
  team_name: "plan-implementation",
});

// 2. Run full verification
await bash("npm run typecheck && npm run lint && npm test");

// 3. Pull completed todos back to Beads
await swarm({ operation: "sync", operation: "pull" });

// 4. Clear swarm data
await swarm({ operation: "monitor", operation: "clear", team_name: "plan-implementation" });

// 5. Close parent bead
await bash("br close parent-task --reason 'Swarm completed all subtasks'");
```
