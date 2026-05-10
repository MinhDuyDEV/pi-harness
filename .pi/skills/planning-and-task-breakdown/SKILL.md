---
name: planning-and-task-breakdown
description: Decomposes a spec into small verifiable tasks with dependencies and acceptance checks. Use when a feature/change has a spec or clear goal and needs an executable implementation plan.
version: 1.0.0
tags: [workflow, planning, agent-coordination]
dependencies: [spec-driven-development]
agent_types: [planner]
tools: [TaskCreate, TaskUpdate, memory, srcwalk_search]
---

# Planning & Task Breakdown

## Overview

A good plan creates leverage for builders. It says what must become true, where to work, what not to touch, and how to prove success.

Core principle: plan backward from observable truths into artifacts, wiring, tasks, dependencies, and verification.

## When to Use

- A spec or clear goal exists and implementation is non-trivial.
- Work spans multiple files, phases, or agents.
- Tasks need dependency ordering or parallelization decisions.
- You need a handoff artifact for worker agents.

## When NOT to Use

- Single-file fixes that can be implemented directly.
- Requirements are still unclear; use `spec-driven-development` first.
- You are debugging an active failure; use `debugging-and-error-recovery`.

## Workflow

1. Restate the goal and constraints.
2. Convert observable truths into required artifacts.
3. Identify required wiring between artifacts.
4. Mark key links most likely to break.
5. Decompose into vertical slices, not horizontal layers.
6. Limit each task to a small scope with exact files when known.
7. Add acceptance checks and verification commands to every task.
8. Build a dependency graph and execution order.
9. Create tracked tasks or write a plan artifact.

## Task Packet Template

```markdown
## Task N: [Name]

Goal: [one sentence]
Files in scope:
- [path]
Acceptance checks:
- [behavior] -> verify with [command/check]
Non-goals:
- [explicit exclusion]
Dependencies:
- [task id/name or none]
Review depth: targeted|standard|full
```

## Slicing Rules

- Prefer vertical slices that produce end-to-end behavior.
- Put risky unknowns first.
- Do not mix refactors with feature behavior unless the refactor is required.
- If one task touches more than five files, split it.
- If a task needs architectural judgment, route to `planner`, not `worker`.

## Common Rationalizations

| Rationalization | Rebuttal |
| --- | --- |
| "I'll make tasks as I go" | Hidden dependencies appear too late. Plan the graph first. |
| "Layer-by-layer is cleaner" | Horizontal layers delay integration and hide broken wiring. |
| "Acceptance criteria are obvious" | Workers need objective checks, not intent. |
| "One big task is simpler" | Big tasks are hard to review, rollback, and verify. |

## Red Flags

- Tasks named after vague activities like "update backend".
- No verification command/check per task.
- UI, API, and data work split so nothing works until the end.
- Multiple agents assigned to overlapping files without sequencing.
- Plan omits non-goals or rollback considerations.

## Verification

- Every task has goal, scope, acceptance checks, non-goals, dependencies.
- Execution order respects dependencies.
- Key links are identified for reviewer verification.
- The first task can be implemented without further planning.

## Skill Result Contract

```xml
<skill_result>
  <skill>planning-and-task-breakdown</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Plan/task packets include scope, dependencies, and verification</evidence>
  <artifacts>Task ids or plan file path</artifacts>
  <risks>Large tasks, unresolved dependencies, or none</risks>
</skill_result>
```


## Consolidated Planning Workflow

This is the canonical active planning skill. It absorbs PRD-to-plan and writing-plans responsibilities. Use spec-driven-development first when requirements are still unclear.

Plans should include:
- scope and non-goals;
- ordered tasks with dependencies;
- exact files or search targets when known;
- acceptance checks per task;
- review and verification gates;
- handoff details for subagents with zero assumed context.
