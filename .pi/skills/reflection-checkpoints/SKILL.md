---
name: reflection-checkpoints
description: >
  Use when executing long-running commands (/ship, /lfg) to add self-assessment
  checkpoints that detect scope drift, stalled progress, and premature completion claims.
  Inspired by ByteRover's reflection prompt architecture.
version: 1.0.0
tags: [workflow, quality, autonomous]
dependencies: [verification-before-completion]
---

# Reflection Checkpoints

## When to Use

- During `/ship` execution after completing 50%+ of tasks
- During `/lfg` at each phase transition (Plan→Work→Review→Compound)
- When a task takes significantly longer than estimated
- When context usage exceeds 60% of budget

## When NOT to Use

- Simple, single-task work (< 3 tasks)
- Pure research or exploration commands
- When user explicitly requests fast execution without checkpoints

## Overview

Long-running autonomous execution drifts silently. By the time you notice, you've burned context on the wrong thing. Reflection checkpoints force self-assessment at critical moments — catching drift before it compounds.

**Core principle:** Pause to assess, don't just assess to pause.

## The Four Reflection Types

### 1. Mid-Point Check

**Trigger:** After completing ~50% of planned tasks (e.g., 3 of 6 tasks done)

```
## 🔍 Mid-Point Reflection

**Progress:** [N/M] tasks complete
**Context used:** ~[X]% estimated

### Scope Check
- [ ] Am I still solving the original problem?
- [ ] Have I introduced any unplanned work?
- [ ] Are remaining tasks still correctly scoped?

### Quality Check
- [ ] Do completed tasks actually work (not just "done")?
- [ ] Any verification steps I deferred?
- [ ] Any TODO/FIXME I left that needs addressing?

### Efficiency Check
- [ ] Am I spending context on the right things?
- [ ] Should remaining tasks be parallelized?
- [ ] Any tasks that should be deferred to a follow-up bead?

**Assessment:** [On track / Drifting / Blocked]
**Adjustment:** [None needed / Describe change]
```

### 2. Completion Check

**Trigger:** Before claiming any task or phase is complete

```
## ✅ Completion Check

**Claiming complete:** [task/phase name]

### Evidence Audit
- [ ] Verification command was run (not assumed)
- [ ] Output confirms the claim (not inferred)
- [ ] No stub patterns in modified files
- [ ] Imports/exports are wired (not just declared)

### Goal-Backward Check
- [ ] Does this task achieve its stated end-state?
- [ ] Would a user see the expected behavior?
- [ ] If tested manually, would it work?

**Verdict:** [Complete / Needs work: describe what]
```

### 3. Near-Limit Warning

**Trigger:** When context usage exceeds ~70% or step count approaches limit

```
## ⚠️ Near-Limit Warning

**Context pressure:** [High / Critical]
**Remaining tasks:** [N]

### Triage
1. What MUST be done before stopping? [list critical tasks]
2. What CAN be deferred? [list deferrable tasks]
3. What should be handed off? [list with context needed]

### Action
- [ ] Compress completed work
- [ ] Prioritize remaining tasks ruthlessly
- [ ] Prepare handoff if needed

**Decision:** [Continue (enough budget) / Compress and continue / Handoff now]
```

### 4. Phase Transition Check

**Trigger:** At `/lfg` phase boundaries (Plan→Work, Work→Review, Review→Compound)

```
## 🔄 Phase Transition: [Previous] → [Next]

### Previous Phase Assessment
- **Objective met?** [Yes / Partially / No]
- **Artifacts produced:** [list]
- **Open issues carried forward:** [list or "none"]

### Next Phase Readiness
- [ ] Prerequisites satisfied
- [ ] Context is clean (no stale noise)
- [ ] Correct skills loaded for next phase

**Proceed:** [Yes / Need to resolve: describe]
```

## Integration Points

### In `/ship` (Phase 3 task loop)

After every ceil(totalTasks / 2) tasks, run **Mid-Point Check**:

```typescript
const midpoint = Math.ceil(totalTasks / 2);
if (completedTasks === midpoint) {
  // Run mid-point reflection
  // Log assessment to .beads/artifacts/$BEAD_ID/reflections.md
}
```

Before each task completion claim, run **Completion Check** (lightweight — just the evidence audit).

### In `/lfg` (phase transitions)

At each step boundary (Plan→Work, Work→Review, Review→Compound), run **Phase Transition Check**.

### Context pressure monitoring

When context usage estimate exceeds 70%, run **Near-Limit Warning** regardless of task position.

## Reflection Log

Append all reflections to `.beads/artifacts/$BEAD_ID/reflections.md` (or session-level if no bead):

```markdown
## Reflection Log

### [timestamp] Mid-Point Check

Assessment: On track
Context: ~45% used
Adjustment: None

### [timestamp] Completion Check — Task 3

Verdict: Complete
Evidence: typecheck pass, test pass (12/12)

### [timestamp] Near-Limit Warning

Decision: Compress and continue
Deferred: Task 6 (cosmetic cleanup) → follow-up bead
```

## Gotchas

- **Don't over-reflect** — these are quick self-checks, not long analyses. Each should take < 30 seconds of reasoning.
- **Don't block on minor drift** — if drift is cosmetic (variable naming, style), note it and continue. Only pause for scope drift.
- **Context cost** — each reflection adds ~200-400 tokens. Budget accordingly. Skip mid-point check for < 4 tasks.
- **Not a replacement for verification** — reflections assess trajectory, not correctness. Always run actual verification commands.
