---
name: grill-me
description: Use when you have a rough idea, ADR, PRD, or spec that needs to survive scrutiny before code is written.
metadata:
  version: 1.1.0
  tags:
  - planning
  - review
  - decision
  dependencies:
  - brainstorming
  - spec-driven-development
---

# Grill Me

## When to Use

You have a plan, spec, ADR, or architecture that you want to stress-test before committing to implementation. You want someone to find the holes.

## Core Principle

**A plan that survives a good grilling is a plan worth implementing.** A plan that falls apart under questions would have fallen apart during implementation, costing more.

## How to Grill

Ask:
- "What assumptions are you making that could be wrong?"
- "What's the most likely thing to fail?"
- "What if X is 10x larger / smaller / slower?"
- "What's the cost of being wrong?"
- "What's the simplest way to test this?"
- "What's the hardest part? Why?"
- "What's the rollback plan?"
- "What would make this a mistake?"
- "Who disagrees with this? Why?"
- "What's the non-goal everyone forgets?"
- "What are we not talking about?"

One question at a time. Let the person answer fully before asking another.

Before asking, require all three:
- **Material** — the answer could change architecture, scope, UX, data, security, cost, or acceptance criteria.
- **Grounded** — inspect available source, tests, docs, or prior decisions first; cite the concrete uncertainty.
- **Answerable** — offer real options, an approvable default, or a specific reference request.

Ask a blocking question in this shape:

```md
Blocking question: <one material decision>
Why it matters: <what changes between the live options>
Evidence: <source, test, doc, or stated constraint>
Recommended answer: <default and rationale>
If you don't care: I'll proceed with <default>.
```

Do not ask about low-risk choices a competent implementer can reverse cheaply. Record those as labeled assumptions and explain how they will be verified.

## Anti-rationalization

| Shortcut the model reaches for | Why it fails here |
|---|---|
| "The plan is solid, no need to grill" | "Solid" before grilling is exactly the confidence to test; grill the strong version, don't rubber-stamp. |
| "I don't want to seem disagreeable" | Politeness kills the plan; the grilling is the value — press hard. |
| "The user seems confident, back off" | User confidence is the bias to probe, not the signal to stop; the stop rule is exhaustion of flaws. |

## Quality bar and stop rule

Questions should surface assumptions, not opinions. Stay curious rather than confrontational, document answers, and stop when each material question has a concrete answer or the questions begin repeating.

Common mistakes are asking five questions at once, grilling trivial choices, stopping after easy questions, or treating the review as an attack. Require assumptions, a rollback plan, ranges for cost/scale, and explicit dependencies before approving the plan.
