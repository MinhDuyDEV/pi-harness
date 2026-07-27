# Deep Tracing — backward trace and boundary instrumentation

Detail for `debugging-and-error-recovery`. Use when the failure surfaces far (10+ layers) from its cause, the error message is misleading, or the same fix keeps coming back.

## The Backward Trace

Start at the symptom and walk upstream. Never trace forward from "where the bug might be".

```
[Symptom layer: where the failure surfaces]
  ↑ "what input did this function receive?"
  ↑ "what called this function?"
  ↑ "what data did THAT receive?"
  ↑ "where did THAT data come from?"
  ↑ [Root layer: where invalid state originated]
```

Each `↑` is one step. At each step: log the input, log the output, confirm or clear the boundary. Write the chain down as you go — a trace that lives only in your head resets every time a probe surprises you.

## Boundary Logging

Log at the boundary between suspect layers, not inside them. Body logging creates noise; boundary logging creates a chain of evidence.

```ts
// BAD: log in the middle
function processUser(user) {
  console.log("processing user", user) // noise
  // ...
}

// GOOD: log at the boundary
function processUser(user: User): Result {
  logger.debug("processUser.input", { userId: user.id, ...user })
  // ...
  logger.debug("processUser.output", { result })
  return result
}
```

Rules:

- **One hypothesis per probe.** If a probe can't distinguish X from not-X, it's a guess, not a probe.
- **Structured objects, not strings.** String logs can't be compared across layers.
- **Add probes one boundary at a time.** Ten log lines at once tell you nothing about ordering or causality.
- **Don't stop at the first plausible cause.** It may be an intermediate layer, not the root. Keep asking "where did that data come from?" until the answer is an external input, a constant, or a write you control.

## Root-Cause Triggers

Symptom phrasing often points directly at a cause family:

| Trigger | Implication |
| --- | --- |
| Dev / prod mismatch | Env, config, secrets, data, race |
| "Was fine yesterday" | Recent change, deploy, data drift, dep bump |
| "Only user X" | Data, identity, permissions |
| "Sometimes" | Race, timing, cache, ordering |
| "Friday's fix broke it" | Bisect, dep, schema |

## Test Pollution

When a test fails only in combination with others (state leaks between tests, files created and never cleaned), bisect with the bundled script:

```bash
.pi/skills/debugging-and-error-recovery/scripts/find-polluter.sh '<polluted-file-or-dir>' 'src/**/*.test.ts'
```

It runs the test files one at a time and reports the first one that creates the unwanted state.

## When You Find the Root

- Write a regression test that would have caught the original symptom.
- Fix the upstream invariant (a type, a guard, a parse, a contract) — not the symptom layer. If the bad state can still reach the symptom, removing the symptom changed nothing.
- Re-run the trace from symptom to root to confirm the chain is clean, then remove or downgrade the temporary probes.
