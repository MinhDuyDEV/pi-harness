---
name: grill-me
description: Stress-tests a plan, spec, ADR, or architecture by interviewing the author one material question at a time. Use when an idea needs scrutiny before code, or when the user asks to be grilled on a design.
metadata:
  version: 2.0.0
  tags:
  - planning
  - review
  - decision
  dependencies:
  - brainstorming
  - spec-driven-development
---

# Grill Me

## Core Principle

**A plan that survives a good grilling is a plan worth implementing.** A plan that falls apart under questions would have fallen apart during implementation, at higher cost.

## When to Use

A plan, spec, ADR, or architecture needs stress-testing before implementation. The goal is to find the holes, not to rubber-stamp.

## How to Grill

Ask questions that surface assumptions:

- "What assumptions are you making that could be wrong?"
- "What's the most likely thing to fail?"
- "What if X is 10x larger / smaller / slower?"
- "What's the cost of being wrong? What's the rollback plan?"
- "What's the hardest part? Why?"
- "What would make this a mistake? Who disagrees?"
- "What are we not talking about?"

**One question at a time.** Wait for a full answer before the next. If the codebase can answer a question, explore the codebase instead of asking.

Before asking, require all three:

- **Material** — the answer could change architecture, scope, UX, data, security, cost, or acceptance criteria.
- **Grounded** — inspect available source, tests, docs, or prior decisions first; cite the concrete uncertainty.
- **Answerable** — offer real options, an approvable default, or a specific reference request.

```md
Blocking question: <one material decision>
Why it matters: <what changes between the live options>
Evidence: <source, test, doc, or stated constraint>
Recommended answer: <default and rationale>
If you don't care: I'll proceed with <default>.
```

Don't grill low-risk choices a competent implementer can reverse cheaply. Record those as labeled assumptions with how they will be verified.

## With-Docs Mode

When the repo has documented decisions, grill against them, not from memory:

- **Check the glossary.** If `CONTEXT.md` exists (or `CONTEXT-MAP.md` for multi-context repos), challenge terms that conflict with it: "Your glossary defines 'cancellation' as X, but you mean Y — which is it?" Sharpen fuzzy terms into canonical ones.
- **Check the ADRs.** If the plan contradicts a decision in `docs/adr/`, surface the tension explicitly — an old ADR is a finding to resolve, not a reason to skip.
- **Cross-reference with code.** When the author states how something works, verify the code agrees; surface contradictions.
- **Capture as you go.** Update `CONTEXT.md` the moment a term is resolved (glossary only — no implementation details); format in [references/CONTEXT-FORMAT.md](references/CONTEXT-FORMAT.md). Offer an ADR only when the decision is hard to reverse, surprising without context, and a real trade-off — see `documentation-and-adrs` for the format.

## Stop Rule

Stay curious, not confrontational. Document answers. Stop when every material question has a concrete answer or the questions begin repeating. Before approving, require: assumptions listed, rollback plan, ranges for cost/scale, explicit dependencies.

## Anti-rationalization

| Shortcut the model reaches for | Why it fails here |
|---|---|
| "The plan is solid, no need to grill" | "Solid" before grilling is exactly the confidence to test. |
| "I don't want to seem disagreeable" | Politeness kills the plan; pressing hard is the value. |
| "The user seems confident, back off" | Confidence is the bias to probe; the stop rule is exhaustion of flaws. |
| "I know the codebase, I'll grill from memory" | Memory drifts; grill against the actual code, glossary, and ADRs. |

## Red Flags

Five questions at once; grilling trivial reversible choices; stopping after the easy questions; treating the review as an attack; approving without assumptions, rollback, and dependencies on record; ignoring a glossary or ADR conflict because it is inconvenient.
