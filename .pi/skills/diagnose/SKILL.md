---
name: diagnose
description: Use when the user says "diagnose this" / "debug this", reports a bug, says something is broken/throwing/failing,
  or describes a performance regression.
metadata:
  version: 1.0.0
---

# Diagnose

## Core Principle

**Root cause over local patch.** Fix the invariant that makes the failure class impossible, not the instance. A "fix" that only addresses the symptom and leaves the bug class possible is a paper-over, not a fix.

## When to Use

User says "diagnose", "debug", "broken", "failing", "throws", "regression"; multiple fix attempts have not worked (per `debugging-and-error-recovery`); performance regression with unknown cause; symptom is reported, root cause is not.

## When NOT to Use

Root cause is already known (use `incremental-implementation`); single-line change with a known cause; user only wants a workaround.

## The Diagnose Loop

```
observe (symptom) ──> hypothesize (cause) ──> instrument (test) ──> confirm (or revise)
   │                       │                      │                       │
   │                       │                  add logging,              if false,
   │                       │                  a probe, or a            loop back.
   │                       │                  failing test.
```

Each cycle is small. Do not stack 5 hypotheses before testing any. **A hypothesis that can't be tested is a guess, not a hypothesis.**

## Workflow

1. **Gather** — full error, logs, repro, recent changes, env. No fix proposal until symptom fits in one sentence.
2. **Localize** — failing layer: input, validation, business logic, persistence, integration, env. Boundary is the search area.
3. **Hypothesize** — one or two causes, each testable by probe / log / failing test.
4. **Instrument** — minimum probe that distinguishes the candidates. Prefer a failing test (`test-driven-development`).
5. **Confirm or revise** — run the probe. Falsify → loop. Confirm → root cause is the layer it points at.
6. **Fix the invariant** — smallest change that makes the failure class impossible (type, guard, parse, contract). Not the instance band-aid.
7. **Guard** — regression test that would have caught the original symptom. Without it, the class can reappear.

## Root-Cause Triggers

| Trigger | Implication |
| --- | --- |
| Dev / prod mismatch | Env, config, secrets, data, race |
| "Was fine yesterday" | Recent change, deploy, data drift, dep bump |
| "Only user X" | Data, identity, permissions |
| "Sometimes" | Race, timing, cache, ordering |
| "Friday's fix broke it" | Bisect, dep, schema |

## Trace Backward

When the failure is deep, trace backward: what input reached this function, what path produced it, what called it, what changed. Log at the boundary between suspect layers. **Don't fix the symptom layer** — fix the upstream cause.

## Red Flags

Multiple fix attempts without a hypothesis; "probably X" without a probe; patch hides the symptom without addressing why the bad state was reached; regression test skipped because "hard to reproduce" (guard absent); same area keeps breaking (invariant missing).

## Anti-Patterns

Shotgun debug (5 fixes, hope one); log without a hypothesis (noise, not signal); "just restart" (recovers ≠ diagnoses); blaming the user (a missing validator is missing, not user error).

## Skill Result Contract

```
<skill_result>
  <skill>diagnose</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Hypothesis, probe, root cause confirmed, invariant fix, guard</evidence>
  <artifacts>Probe / test / fix / guard paths</artifacts>
  <risks>Untested hypotheses, instance patch, missing guard, or none</risks>
</skill_result>
```
