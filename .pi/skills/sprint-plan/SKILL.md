---
name: sprint-plan
description: Use during sprint Plan phase to create a multi-perspective implementation plan with architecture, engineering, and design review lenses.
version: 1.0.0
tags: [workflow, sprint, planning]
dependencies: [writing-plans]
---

# Sprint Plan

## When to Use
- Sprint Think phase is complete with an approved design doc
- You need an implementation plan reviewed from multiple perspectives
- Building something complex enough to benefit from structured task decomposition

## When NOT to Use
- No design doc exists (run Think phase first)
- Simple change that needs 1-3 tasks (just plan inline)
- You're resuming a sprint that already completed Plan phase

## Overview

Plan applies three review lenses to the design doc before producing a task breakdown. This catches architectural flaws, engineering complexity, and design gaps BEFORE any code is written — when changes are cheapest.

**Input**: `.beads/sprints/<sprint-id>/design.md`
**Output**: `.beads/sprints/<sprint-id>/plan.md`

## The Process

### Step 0: Load Design Doc

Read the design doc and sprint state. Verify `gates.think-approved === true`.

```
Read: .beads/sprints/<sprint-id>/design.md
Read: .beads/sprints/<sprint-id>/state.json
```

### Step 1: Scope Challenge

Before planning, challenge the scope with these cognitive patterns:

**One-Way Door Test** (Bezos): Which decisions are irreversible? Those get extra scrutiny. Reversible decisions should be made fast.

**Essential Complexity Check** (Brooks): Is the complexity inherent to the problem, or are we adding accidental complexity? If the plan has more than 8 files to modify, ask: "Can this be decomposed into smaller sprints?"

**Inversion** (Munger): What would make this fail? Work backward from failure modes to prevent them.

**Boring Technology Bonus** (McKinley): For each technical choice, prefer the boring option. Novel technology needs a compelling justification.

Present scope challenge findings to user before proceeding.

### Step 2: Architecture Lens

Review the design from a systems perspective:

- **Boundaries**: Are module boundaries clear? Where does this feature touch existing systems?
- **Data flow**: Trace data from input to storage to output. Any bottlenecks?
- **Dependencies**: What does this depend on? What depends on this? Use `tilth_deps()` to verify.
- **Failure modes**: What happens when each dependency fails? Graceful degradation?
- **API surface**: Is the public API minimal? Can it be smaller?

Spawn explore agent for dependency analysis:
```typescript
task({
  subagent_type: "explore",
  description: "Dependency and blast radius analysis",
  prompt: "Map all files and interfaces affected by: <design summary>. Show dependency graph and blast radius."
})
```

### Step 3: Engineering Lens

Review from an implementer's perspective:

- **Testability**: Can every behavior be tested in isolation? Any hidden dependencies?
- **Complexity budget**: Estimate cyclomatic complexity. Flag anything that feels like it needs a comment to explain.
- **Existing patterns**: Does the codebase already do something similar? Use that pattern.
- **Migration path**: If this changes existing behavior, what's the migration strategy?
- **Rollback plan**: If this breaks production, how do we revert?

### Step 4: Design Lens

Review from a user/API consumer perspective:

- **API ergonomics**: Is the interface intuitive? Would a new developer understand it without reading the source?
- **Error messages**: Are errors actionable? Does the user know what to do next?
- **Edge cases**: Empty states, maximum limits, concurrent access, partial failures
- **Consistency**: Does this follow existing patterns in the codebase?

### Step 5: Task Decomposition

Load the `writing-plans` skill for structured decomposition:
```
skill({ name: "writing-plans" })
```

Apply wave-based planning from writing-plans:
1. **Wave 1**: Foundation — interfaces, types, core data structures
2. **Wave 2**: Implementation — business logic, handlers, services
3. **Wave 3**: Integration — wiring, configuration, API endpoints
4. **Wave 4**: Verification — tests, documentation, cleanup

Each task must have:
- Clear acceptance criteria with verification command
- TDD steps (test first, then implement)
- Estimated complexity (S/M/L)
- Dependencies on other tasks
- Files affected

### Step 6: Risk Registry

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|-----------|--------|------------|-------|
| [From architecture lens] | Low/Med/High | Low/Med/High | [Action] | [Phase] |
| [From engineering lens] | Low/Med/High | Low/Med/High | [Action] | [Phase] |

### Step 7: Write Plan

Save plan to `.beads/sprints/<sprint-id>/plan.md` with sections:
1. Scope Challenge Results
2. Architecture Review Findings
3. Engineering Review Findings
4. Design Review Findings
5. Task Breakdown (waves with TDD steps)
6. Risk Registry
7. Definition of Done

### Step 8: Gate — User Approval

```
question({
  questions: [{
    header: "Plan Gate",
    question: "Implementation plan complete. How to proceed?",
    options: [
      { label: "Approve — move to Build", description: "Plan is solid, start implementing" },
      { label: "Revise scope", description: "Adjust scope or task breakdown" },
      { label: "Back to Think", description: "Design needs fundamental changes" }
    ]
  }]
})
```

On approval: update sprint state, set `gates.plan-approved = true`.

## Key Principles

- **Three lenses are non-negotiable**: Even for "obvious" plans. The 5 minutes spent on each lens prevents days of rework.
- **Scope challenge first**: Before decomposing tasks, verify the scope is right. Planning the wrong thing precisely is worse than not planning at all.
- **Wave boundaries are rollback points**: Each wave should leave the codebase in a working state.

## After Plan
Plan approved → Build phase begins. Load `/skill:executing-plans` with the plan.
