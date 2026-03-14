# Tier Enforcement (Longshot Pattern)

For multi-agent execution at scale (10+ agents), enforce explicit tier hierarchy. This is the Longshot pattern that enabled 200 agents to build Minecraft.

## Tier System

| Tier            | Role                  | Swarm Equivalent | Responsibility                                                 |
| --------------- | --------------------- | ---------------- | -------------------------------------------------------------- |
| **planner**     | Lead orchestrator     | Build agent      | Analyzes scope, decomposes into sub-tasks, coordinates workers |
| **sub-planner** | Mid-level coordinator | N/A              | Takes planner output, further decomposes, assigns to workers   |
| **worker**      | Execution agent       | Worker agents    | Executes assigned work, reports progress                       |

## When Tiers Are Required

- **<10 agents**: Optional - flat decomposition works
- **10-50 agents**: Recommended - planner + workers
- **50+ agents**: Required - planner + sub-planners + workers

## Enforcing Tier Boundaries

The swarm leader enforces tier boundaries:

```typescript
// Tier enforcement in swarm execution
async function enforceTiers(waves, tierConfig) {
  // Wave 1: Planner tasks only
  const planners = waves.filter((w) => w.tier === "planner");
  await executeWave(planners);

  // Wave 2: Sub-planner tasks (if any)
  const subPlanners = waves.filter((w) => w.tier === "sub-planner");
  await executeWave(subPlanners);

  // Wave 3+: Worker tasks
  const workers = waves.filter((w) => w.tier === "worker");
  await executeWave(workers);
}
```

## Handoff Contracts Between Tiers

Each tier must declare handoff contracts:

```typescript
// Planner declares what it produces for sub-planners
const plannerHandoff = {
  produces: [
    { artifact: "docs/auth-design.md", format: "markdown" },
    { artifact: "tasks/auth-tasks.json", format: "json" },
  ],
  consumedBy: ["sub-planner-auth"],
};

// Worker declares what it consumes from sub-planners
const workerHandoff = {
  consumes: [{ artifact: "tasks/auth-tasks.json", format: "json" }],
  produces: [{ artifact: "src/auth/service.ts", format: "typescript" }],
};
```

## Anti-Pattern: Flat Decomposition at Scale

Without tiers, 20 agents get 20 flat tasks → chaos:

- Workers step on each other
- No coordination between related work
- Merge conflicts everywhere
- No clear ownership

With tiers (Longshot pattern):

```
Lead Planner → Sub-planner A → Worker 1, 2, 3
              → Sub-planner B → Worker 4, 5, 6
              Sub-planner C → Worker 7, 8, 9
```

This mirrors real engineering orgs: lead → tech lead → IC. The architecture is the differentiator.
