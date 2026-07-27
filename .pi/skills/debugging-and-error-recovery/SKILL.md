---
name: debugging-and-error-recovery
description: Systematic debugging from symptom to root cause to guarded fix, built on a red-capable feedback loop. Use when tests fail, builds break, behavior is unexpected, or previous fix attempts have not held.
metadata:
  version: 2.0.0
  tags:
  - debugging
  - workflow
  - verification
  dependencies:
  - test-driven-development
  - verification-before-completion
---

# Debugging & Error Recovery

## Core Principle

**Build the feedback loop before the theory.** Debugging starts with a red-capable command: one command that reproduces the failure and can turn green. **No red-capable command, no theory-building** — reading code and guessing without a pass/fail signal is speculation. A 2-second deterministic loop beats a 30-second flaky one; tighten the loop before chasing causes.

## When to Use

Test, lint, typecheck, build, or runtime failure; a reported bug or unexpected behavior; a previous fix did not hold. NOT for feature work with no failure signal (`incremental-implementation`) or pure research (`source-driven-development`).

## Workflow

1. **Read the full error** and relevant logs. No fix proposal until the symptom fits in one sentence.
2. **Build the loop** — the smallest command that shows the failure red. If it cannot be reproduced, document why and stop guessing.
3. **Localize** the failing layer: input, boundary, business logic, persistence, integration, environment.
4. **Hypothesize** one testable cause. A hypothesis that can't be probed is a guess.
5. **Probe** with the minimum instrument that distinguishes the candidates — prefer a failing test (`test-driven-development`). Falsified → loop back; confirmed → that layer holds the root cause.
6. **Fix the invariant, not the instance** — the smallest change that makes the failure class impossible (a type, guard, parse, or contract).
7. **Guard** — a regression test that would have caught the original symptom.
8. **Verify** — the original red command is now green and related checks show no regression.

## Trace Backward, Log at Boundaries

When the failure surfaces far from its cause, start at the symptom and walk upstream: what input reached this function, what called it, where did that data come from. Add structured probes at the boundary between suspect layers — one hypothesis per probe. Never fix the symptom layer when the cause is upstream. See [references/deep-tracing.md](references/deep-tracing.md) for the backward-trace method, boundary-logging examples, and the root-cause trigger table.

For test pollution (a test that fails only alongside others), bisect with `scripts/find-polluter.sh '<polluted-path>' '<test-glob>'`.

## Evidence Log

For complex bugs, keep a short log in the response or a debug artifact:

```markdown
## Symptoms / Reproduction / Hypotheses eliminated / Root cause / Fix and guard
```

## Retry and Escalation

Retry once with the same tool, then switch to a fallback approach. Before every new attempt, run a map-vs-territory check: re-read the request and notes — repeated failures are usually a mapping problem, not an execution problem. After three failed fix attempts, stop and escalate with what was tried, what was eliminated, and what you recommend.

## Common Rationalizations

| Rationalization | Rebuttal |
| --- | --- |
| "This is probably the issue" | Probably is a hypothesis, not evidence. Probe it. |
| "No time to build a repro" | Without a red command, every fix is a guess you can't check. |
| "I'll patch the symptom now" | Symptom patches hide root causes and regress later. |
| "Multiple fixes will save time" | You won't know which change mattered. |
| "The test failure is unrelated" | Prove it with isolation before ignoring it. |
| "One more attempt" | After three failed fixes the model is wrong. Stop and rethink. |

## Red Flags

Code changed before the failure is reproduced; fix proposed before reading the full error; shotgun debugging (several fixes at once, hoping one lands); logging without a hypothesis; regression test skipped for a reproducible bug; success claimed without re-running the original red command; new failures appearing in other layers — escalate, don't grind.
