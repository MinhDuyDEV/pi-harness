---
name: quality-loop
version: 1.0.0
description: "Use after implementation when an iterative fix-verify loop is needed until all quality gates pass or max iterations reached. Prevents the 'single-shot verification' failure mode where a fix introduces new issues."
tags: [workflow, code-quality, verification]
dependencies: [verification-before-completion]
agent_types: [worker, reviewer]
tools: [bash, grep, find, read]
---

# Quality Loop

## When to Use

Implementation is "done" but a quality gate fails (test, typecheck, lint, security, perf); iterative refinement is needed; "fix and re-verify" loop is the right shape.

## When NOT to Use

Trivial one-line change (just fix it); first attempt at the implementation (no baseline yet); problem is in the design, not the implementation (use `diagnose` or `brainstorming`); the gate is unclear (define it first).

## Core Principle

**Fix → verify → assess → repeat, with an iteration cap.** Each iteration: identify the gap, fix the smallest thing, verify, decide if to continue or escalate. A loop without a cap is a sink.

## The Loop

```
for i in 1..N:
  run_quality_gate()
  if pass: return success
  if i == N: return failure (with all errors listed)
  smallest_fix_for_largest_gap()
```

Where:
- `run_quality_gate` is the named check (test/typecheck/lint/security)
- `smallest_fix_for_largest_gap` = the fix that resolves the most failing checks with the least change
- N is a cap (typically 3-5 iterations)

## When to Iterate vs Escalate

| Continue | Stop |
|---|---|
| Same kind of failure, fix is clear | Different kind of failure (signal of deeper issue) |
| Errors decreasing | Errors plateauing or increasing |
| Root cause narrowing | New errors introduced each iteration |
| Fix scope understood | Fix scope growing each iteration |

## Iteration Cap

Always set N. The cap protects against:
- Loops where the fix introduces new errors
- Loops where the gap is unclear (you'll burn the whole session)
- Loops where the design is wrong (fixing implementation won't help)

After N iterations with the same shape of error, **escalate**: the problem is probably upstream of the implementation.

## Common Mistakes

No iteration cap (infinite loop); counting iterations on a single tool (each tool call doesn't count); fixing the symptom not the cause; re-running the gate before the fix (why?); reverting to "no change" between iterations (lost progress); treating "fewer errors" as success (errors could beplate, not decrease); iterating past the cap; scope creep in the fix (now you're doing cleanup, not fix).

## Red Flags

Loop has no max; iterations counted wrong; "fix" introduces new errors (regression); same Nth attempt as 1st (no learning); scope grew with each iteration (now you're redesigning); error count isn't actually decreasing; gate changed between iterations (different test); "I think it's better" without re-running the gate.

## Self-Quiz

- Is the gate named explicitly? (not "tests" but `npm test` or specific file)
- Is there a cap? What is it?
- Are iterations on the gate, not on guesses?
- Is each fix the smallest that resolves the most?
- Am I escalating when the cap is hit (or sooner)?
