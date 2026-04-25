---
name: spec-driven-development
description: Guides agents from vague request to concrete specification before implementation. Use when starting a new feature, significant change, product idea, or when requirements are ambiguous.
version: 1.0.0
tags: [workflow, planning, product]
dependencies: []
agent_types: [planner, scout]
tools: [ask_user_question, TaskCreate, memory]
---

# Spec-Driven Development

## Overview

A spec converts intent into testable truth. Code written before the target is clear becomes rework.

Core principle: define observable outcomes, constraints, non-goals, and verification before planning implementation.

## When to Use

- User asks for a new feature or significant behavior change.
- Requirements are vague, conflicting, or missing edge cases.
- Multiple files/systems will be affected.
- The work needs acceptance criteria or user-visible behavior.

## When NOT to Use

- Tiny mechanical edits with obvious expected behavior.
- Emergency bug fixes where reproduction is already clear; use `debugging-and-error-recovery`.
- Pure research with no implementation decision; use `source-driven-development`.

## Workflow

1. State the goal as an outcome, not a task.
2. Derive 3-7 observable truths from the user's perspective.
3. Identify constraints: technical, UX, security, performance, compatibility.
4. Define non-goals to prevent scope creep.
5. List affected surfaces: files, APIs, commands, UI screens, data models.
6. Define acceptance criteria with verification methods.
7. Ask at most 1-4 focused questions only if missing information changes the design.
8. Hand off to `planning-and-task-breakdown` when the spec is stable.

## Spec Template

```markdown
# Spec: [Name]

## Goal
[Outcome in one sentence]

## Observable Truths
- [User/system can observe X]

## Constraints
- [Hard constraint]

## Non-Goals
- [Explicitly out of scope]

## Affected Surfaces
- [File/API/UI/data area]

## Acceptance Criteria
- [Criterion] -> verify with [command/check/manual observation]

## Open Questions
- [Question or none]
```

## Common Rationalizations

| Rationalization | Rebuttal |
| --- | --- |
| "The user already explained it" | Explanation is not acceptance criteria. Write the target down. |
| "I'll discover requirements while coding" | Discovery during coding causes churn and hidden scope expansion. |
| "This is obvious" | Obvious to you is not a contract for the next agent or reviewer. |
| "Questions slow us down" | One precise question is cheaper than implementing the wrong behavior. |

## Red Flags

- No explicit non-goals for a broad feature.
- Acceptance criteria are phrased as implementation tasks.
- Edge cases are deferred without user agreement.
- The plan starts before observable truths are defined.
- User-visible behavior has no verification method.

## Verification

- Goal is outcome-shaped.
- Observable truths are human-verifiable.
- Acceptance criteria include commands/checks where possible.
- Ambiguities that affect implementation are resolved or marked as assumptions.

## Skill Result Contract

```xml
<skill_result>
  <skill>spec-driven-development</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Spec sections completed and questions/assumptions recorded</evidence>
  <artifacts>Spec path or inline spec summary</artifacts>
  <risks>Unresolved assumptions or none</risks>
</skill_result>
```
