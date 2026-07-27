---
name: domain-modeling
description: Builds a shared domain vocabulary — ubiquitous language, a CONTEXT.md glossary, entity/value/aggregate boundaries. Use when naming a new concept, when names collide or drift, or when settled decisions keep resurfacing.
metadata:
  version: 1.0.0
  tags:
  - architecture
  - documentation
  dependencies: []
---

# Domain Modeling

## Core Principle

Code quality tracks vocabulary quality. Ubiquitous language means the same term in conversation, code, tests, and docs — when the user says "order" and the code says `Cart`, every future change pays a translation tax.

## When to Use

Naming a new concept; one thing has two names or two things share one; user language conflicts with the code; the model itself is changing. NOT for routine feature work that only consumes the existing vocabulary — reading the glossary is not modeling.

## CONTEXT.md

Each repo keeps a `CONTEXT.md` at root: a glossary of domain terms plus settled architectural decisions.

- Glossary entries only — one line per term; no implementation details, no specs.
- Settled decisions as one-liners with a pointer to the ADR (see `documentation-and-adrs`) — this is what stops re-litigation.
- Update incrementally, the moment a term crystallizes — not in batches at the end.
- Create on demand: only when there is content to capture.
- Multi-context repos: a `CONTEXT-MAP.md` at root pointing to one `CONTEXT.md` per bounded context (e.g. `src/ordering/`, `src/billing/`).

## Pragmatic Building Blocks

| Concept | Test | Consequence |
|---|---|---|
| Entity | identity persists while attributes change | compare by ID; owns a lifecycle |
| Value object | equality by content | immutable; validate at construction; illegal states unrepresentable |
| Aggregate | invariants must hold together | one consistency/transaction boundary; reference other aggregates by ID |

## When a Concept Deserves a Name

Name it when you see: the same three fields passed around together; a pair of booleans with an invalid combination; a comment explaining what a primitive "really is"; if-chains dispatching on the same string values in multiple places. A named type turns a convention into something the compiler enforces.

## Active Practices

- **Challenge terminology**: "the glossary defines X as A, but you seem to mean B — which is accurate?"
- **Sharpen fuzzy words**: "you say 'account' — Customer or User?" Propose a canonical term.
- **Stress-test with scenarios**: concrete edge cases force precise boundaries ("can a guest have an order?").
- **Reconcile code and claims**: stated domain behavior contradicting the actual code is a finding — flag it for resolution, don't paper over it.

## Common Rationalizations

| Excuse | Counter |
|---|---|
| "It's just a string" | Until two call sites disagree on its format. |
| "We all know what it means" | The glossary is for the next session, which knows nothing. |
| "Renaming is churn" | One rename now, or a translation layer forever. |
| "I'll write the glossary at the end" | Terms crystallize mid-conversation; capture them then. |

## Red Flags

Two names for one concept in the same file; `data`, `info`, `manager`, `item` as domain names; the same validation rule duplicated at three boundaries; a "glossary" that has grown specs; asking the user what a core term means twice in one project.
