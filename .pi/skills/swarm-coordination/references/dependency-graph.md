# Dependency Graph Features

The `swarm` tool's plan operation includes full dependency graph analysis:

## Structure

```typescript
interface DependencyGraph {
  nodes: TaskNode[]; // Individual tasks
  edges: Edge[]; // Dependencies between tasks
  critical_path: string[]; // Longest dependency chain
  parallelizable_groups: string[][]; // Tasks that can run in parallel
}

interface TaskNode {
  id: string;
  content: string;
  phase: string;
  worker: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
  blockedBy: string[]; // Tasks this depends on
  blocks: string[]; // Tasks that depend on this
  assignedFiles: string[]; // Files assigned to this task
}
```

## Usage

```typescript
const analysis = await swarm({
  operation: "plan",
  operation: "analyze",
  task: "Refactor API layer",
  files: "src/api/users.ts,src/api/posts.ts,src/api/auth.ts",
});

const plan = JSON.parse(analysis);

// Critical path shows the longest dependency chain
// Focus attention here for optimal completion time
console.log(`Critical path: ${plan.dependency_graph.critical_path.join(" → ")}`);

// Parallelizable groups show which tasks can run simultaneously
// Each group must complete before starting the next
for (let i = 0; i < plan.dependency_graph.parallelizable_groups.length; i++) {
  const group = plan.dependency_graph.parallelizable_groups[i];
  console.log(`Wave ${i + 1}: ${group.join(", ")} (${group.length} parallel tasks)`);
}
```
