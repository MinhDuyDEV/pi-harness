# Drift Check After Each Wave

After every wave completes and before starting the next, run a **drift check** to verify the codebase has not deviated from the intended state. Accumulated drift between waves is the primary cause of cascading failures in large swarms.

**Drift** = any difference between actual codebase state and the plan's expected state at a wave boundary.

## What to Check

| Check             | Command                                            | Passing Condition              |
| ----------------- | -------------------------------------------------- | ------------------------------ |
| Build gates       | `npm run typecheck && npm run lint`                | Zero errors                    |
| Unexpected files  | `git diff --name-only HEAD`                        | Only planned files modified    |
| Missing artifacts | Verify expected files exist                        | All declared outputs present   |
| Scope adherence   | Compare `git status` vs wave's declared file scope | No out-of-scope files modified |

## Drift Check Protocol

Run after every wave, before spawning the next:

```typescript
async function driftCheckAfterWave(wave: Wave, expectedFiles: string[]) {
  console.log(`\n=== DRIFT CHECK: Wave ${wave.number} ===`);

  // 1. Build gates must pass
  const gates = await bash("npm run typecheck && npm run lint");
  if (!gates.success) {
    throw new Error(`Wave ${wave.number} drift: build gates failed\n${gates.output}`);
  }

  // 2. Detect unexpected file modifications
  const changedFiles = await bash("git diff --name-only HEAD");
  const actualFiles = changedFiles.output.trim().split("\n").filter(Boolean);
  const unexpected = actualFiles.filter((f) => !expectedFiles.includes(f));

  if (unexpected.length > 0) {
    console.warn(`⚠️  Unexpected files modified in wave ${wave.number}:`);
    unexpected.forEach((f) => console.warn(`  - ${f}`));
  }

  // 3. Verify declared artifacts exist
  for (const artifact of wave.expectedArtifacts ?? []) {
    const exists = await bash(`test -f ${artifact} && echo "ok" || echo "missing"`);
    if (exists.output.trim() === "missing") {
      throw new Error(`Wave ${wave.number} drift: expected artifact missing: ${artifact}`);
    }
  }

  console.log(`✓ Drift check passed: Wave ${wave.number}`);
}
```

## Integration in Wave Execution

Call drift check between every wave:

```typescript
for (let i = 0; i < waves.length; i++) {
  const wave = waves[i];
  const reconciler = runReconciler(teamName, "npm run typecheck && npm run lint");

  await Promise.all(wave.tasks.map((task) => spawnWorker(task, teamName)));
  await reconciler;

  // MANDATORY: Drift check before next wave
  await driftCheckAfterWave(
    wave,
    wave.tasks.flatMap((t) => t.assignedFiles),
  );

  console.log(`✓ Wave ${i + 1}/${waves.length} complete and verified`);
}
```

## Drift Response Protocol

| Drift Type               | Severity | Action                                           |
| ------------------------ | -------- | ------------------------------------------------ |
| Build gate failure       | Critical | Stop swarm, run reconciler, fix before next wave |
| Unexpected file modified | Warning  | Review change, revert if out of scope            |
| Missing artifact         | Critical | Re-run failed worker task, verify output         |
| Scope creep              | Warning  | Escalate to user if >3 unexpected files changed  |

## When Drift Is Unrecoverable

If drift check fails twice in a row on the same wave:

1. **Stop the swarm** - don't start next wave
2. **Report to user**: exact drift details, failing gate output, list of unexpected files
3. **Rollback option**: use `git reset --hard <wave-N-start-tag>` (see `executing-plans` skill)
4. **Never paper over drift** - proceeding with known drift compounds into cascading failure
