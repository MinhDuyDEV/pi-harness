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

**Define the vocabulary first.** Every concept in the spec should have one name — that name must match what the code will call it. This is Evans' "ubiquitous language": a shared vocabulary between developers, domain experts, code, and AI context files. Ambiguous language in the spec causes the "AI does the wrong thing" failure mode: the LLM implements what the words say, not what you meant.

After writing the spec, extract a glossary of terms. Every capitalized concept in the spec should correspond to exactly one code symbol (type, class, module, function, file). If two terms mean the same thing, pick one. If one term means two things, split it.

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
2. **Establish vocabulary**: define the key terms and map them to code concepts.
3. Derive 3-7 observable truths from the user's perspective.
4. Identify constraints: technical, UX, security, performance, compatibility.
5. Define non-goals to prevent scope creep.
6. List affected surfaces: files, APIs, commands, UI screens, data models.
7. Define acceptance criteria with verification methods.
8. **Check vocabulary consistency**: does every spec term map to exactly one code symbol? Are any terms overloaded?
9. Ask at most 1-4 focused questions only if missing information changes the design.
10. Hand off to `planning-and-task-breakdown` when the spec is stable.

## Spec Template

```markdown
# Spec: [Name]

## Goal
[Outcome in one sentence]

## Vocabulary
| Term | Definition | Code symbol |
|------|------------|-------------|
| ...  | ...        | ...         |

Every concept should have one name. If two terms mean the same thing, consolidate. If one term means two things, split it.

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
| "The AI will figure out what I mean" | The AI will implement exactly what the spec says. Ambiguous language = wrong implementation. |
| "Questions slow us down" | One precise question is cheaper than implementing the wrong behavior. |

## Red Flags

- No explicit non-goals for a broad feature.
- Acceptance criteria are phrased as implementation tasks.
- Edge cases are deferred without user agreement.
- The plan starts before observable truths are defined.
- User-visible behavior has no verification method.
- **No vocabulary section** — missing ubiquitous language means AI will guess term meanings.
- **Same term used for different concepts** — e.g. "Order" means creation flow in one place and fulfillment in another.
- **Different terms for the same concept** — e.g. "User" vs "Account" vs "Profile" used interchangeably.

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
