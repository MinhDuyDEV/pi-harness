# Reconciler Agent Pattern (Self-Healing)

The reconciler is the key to scaling beyond 50+ agents. Without reconciliation, broken builds cascade and the swarm collapses. The reconciler provides **continuous self-healing** by watching for failures and spawning targeted fix tasks.

## When to Use Reconciler

- **50+ agents** running in parallel → **REQUIRED**
- **10-50 agents** → Recommended
- **<10 agents** → Optional (leader can handle)

## Reconciler Responsibilities

1. **Watch CI/Build Status**: Monitor build gates continuously
2. **Detect Failures**: Identify which worker caused the failure
3. **Analyze Root Cause**: Determine if it's a merge conflict, test failure, or type error
4. **Spawn Fix Tasks**: Create targeted fix tasks with context about what failed
5. **Verify Fix**: Wait for fix to pass gates before continuing

## Reconciler vs Leader

| Aspect         | Leader                        | Reconciler                    |
| -------------- | ----------------------------- | ----------------------------- |
| Focus          | Orchestration, spawning       | Recovery, fixing              |
| Runs           | At swarm start, between waves | Continuously during execution |
| On failure     | Spawns workers                | Spawns fix tasks              |
| Failure impact | Can't start work              | Wave can't complete           |

## Implementing Reconciler

The reconciler runs in a loop during swarm execution:

```typescript
// Reconciler runs in background during swarm execution
async function runReconciler(teamName: string, buildCommand: string) {
  while (swarmActive) {
    // 1. Check build status
    const status = await swarm({
      operation: "monitor",
      operation: "status",
      team_name: teamName,
    });
    const stats = JSON.parse(status).summary;

    // 2. If there are errors, investigate
    if (stats.errors > 0) {
      // 3. Get error details
      const errors = await getWorkerErrors(teamName);

      for (const error of errors) {
        // 4. Analyze root cause
        const cause = await analyzeError(error);

        // 5. Spawn fix task
        const fixBead = await br create({
          title: `Fix: ${cause.summary}`,
          type: "bug",
          description: `Detected by reconciler: ${error.message}. Root cause: ${cause.rootCause}. Suggested fix: ${cause.suggestion}`,
        });

        // 6. Assign to targeted worker
        await Task({
          subagent_type: "general",
          description: `Fix ${error.worker}`,
          prompt: `Fix the error in ${error.file}.

Error: ${error.message}
Root cause: ${cause.rootCause}
Suggested fix: ${cause.suggestion}

Run: ${buildCommand}
Verify: npm run typecheck && npm run lint`,
        });
      }
    }

    // Wait before next check
    await sleep(30000); // Check every 30 seconds
  }
}
```

## Error Analysis Patterns

The reconciler categorizes errors:

| Error Type     | Detection                        | Fix Strategy                 |
| -------------- | -------------------------------- | ---------------------------- |
| Merge conflict | "CONFLICT" in output, git status | Re-base, resolve, force push |
| Type error     | "typecheck failed"               | Fix types, run typecheck     |
| Test failure   | "test failed", "expect" mismatch | Fix test or implementation   |
| Lint error     | "lint failed", formatting issues | Run lint:fix                 |
| Build error    | "build failed", bundler errors   | Fix imports, dependencies    |

## Spawning Fix Tasks

When the reconciler spawns a fix task, it includes:

```typescript
// Create fix task with full context
await br create({
  title: `Fix: ${error.type} in ${error.file}`,
  type: "bug",
  description: `## Error Detected
- Worker: ${error.worker}
- File: ${error.file}
- Error: ${error.message}
- Timestamp: ${error.timestamp}

## Root Cause Analysis
${cause.explanation}

## Suggested Fix
${cause.suggestion}

## Verification
Run: ${buildCommand}
Must pass before wave can complete.`,
});
```

## Reconciler in Wave Execution

Add reconciler monitoring to each wave:

```typescript
// Execute wave with reconciler
async function executeWaveWithReconciler(wave, teamName) {
  // Start reconciler in background
  const reconciler = runReconciler(teamName, "npm run typecheck && npm run lint");

  // Execute workers in this wave
  await Promise.all(wave.tasks.map(spawnWorker));

  // Wait for all workers + reconciler to complete
  await reconciler;

  // Verify wave output before proceeding
  await bash("npm run typecheck && npm run lint");
}
```

## Example: Full Swarm with Reconciler

```typescript
// Full swarm execution with reconciler
async function runSwarmWithReconciler(tasks, teamName) {
  // 1. Analyze and create waves
  const waves = createWaves(tasks);

  // 2. Execute each wave with reconciler
  for (const wave of waves) {
    console.log(`Executing wave ${wave.number} with ${wave.tasks.length} tasks`);

    // Start reconciler for this wave
    const reconcilerPromise = runReconciler(teamName, "npm run typecheck && npm run lint");

    // Spawn workers
    await Promise.all(wave.tasks.map((task) => spawnWorker(task, teamName)));

    // Wait for reconciler to finish fixing any errors
    await reconcilerPromise;

    // Verify wave output
    const result = await bash("npm run typecheck && npm run lint");
    if (!result.success) {
      throw new Error(`Wave ${wave.number} failed gates`);
    }

    console.log(`Wave ${wave.number} complete`);
  }
}
```
