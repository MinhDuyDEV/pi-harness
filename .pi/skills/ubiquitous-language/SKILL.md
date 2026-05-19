---
name: ubiquitous-language
description: Establishes and maintains shared vocabulary across codebase, context files, and team conversation — inspired by Evans' Domain-Driven Design and Pocock's AI agent glossary technique. Use when terms are ambiguous, the AI does the wrong thing, or you need to align code with domain concepts.
version: 1.0.0
tags: [architecture, domain-driven-design, ai-workflow]
dependencies: []
agent_types: [planner, scout]
tools: [srcwalk_search, grep, memory]
---

# Ubiquitous Language

> Based on Eric Evans' *Domain-Driven Design* and Matt Pocock's AI-agent glossary technique

## Overview

A ubiquitous language is a **shared vocabulary** that is used consistently across:

- **Code** — types, classes, functions, modules, files
- **Conversation** — how developers and domain experts talk about the system
- **AI context** — AGENTS.md, CLAUDE.md, and other files that guide AI agents
- **Specs and docs** — PRDs, design docs, specifications

When these four use the same words for the same concepts, communication is precise, AI agents produce correct code more often, and the "wrong thing" failure mode is dramatically reduced.

When they diverge, every translation gap is a bug waiting to happen.

> *"Conversations among developers and expressions of the code are all derived from the same domain model."* — Eric Evans

**Why this matters for AI agents:** Matt Pocock demonstrated that feeding a structured glossary (extracted from the codebase) as persistent context to an LLM reduces verbose reasoning and aligns implementation more closely with intent. Ubiquitous language isn't a documentation luxury — it's a direct input into AI correctness.

## When to Use

- Terms are used interchangeably that shouldn't be ("User" vs "Account" vs "Profile")
- AI agents consistently implement the wrong concept
- Specs use different vocabulary than the codebase
- Starting a new domain module that needs clear boundaries
- Onboarding new developers or agents who need to learn the vocabulary
- The codebase has multiple ways to refer to the same domain concept

## When NOT to Use

- Trivial utilities with no domain concept at stake
- Short-lived spike code
- Already consistent codebases with clear terminology (maintain, don't re-engineer)

## Core Principle

> **Every concept in the domain should have exactly one name in the codebase.**

If two terms mean the same thing, consolidate. If one term means two different things, split them into separate concepts with separate names.

## Technique 1: Glossary Extraction

### From Codebase

Scan the codebase for key terms and build a glossary:

```
src/
  types/          → Extract type/interface names
  models/         → Extract model/entity names  
  routes/         → Extract resource names from URL patterns
  services/       → Extract domain operation names
  commands/       → Extract command/mutation names
```

**Automated approach:**
```bash
# Extract type definitions (TypeScript example)
grep -rn "^export (type|interface|class|enum) " src/ --include='*.ts' | 
  cut -d' ' -f3- | sort -u

# Extract module/file names that correspond to domain concepts
ls -d src/models/*/ | xargs -I{} basename {} | sort -u
```

### From AGENTS.md / Context Files

Every term used in your AGENTS.md or CLAUDE.md should map to a code symbol. Cross-reference:

1. List every capitalized noun phrase in AGENTS.md
2. Search the codebase for each phrase
3. For mismatches: either rename the code symbol or update the context file

### Glossary Table Format

```markdown
## Glossary

| Term | Definition | Code Symbol | Context |
|------|------------|-------------|---------|
| Order | A customer's purchase request in PENDING state | `Order` class, `orders` table | Checkout context |
| OrderFulfillment | The shipping/delivery of items for an Order | `Fulfillment` class, `fulfillments` table | Fulfillment context |
| User | An authenticated person using the system | `User` model, `users` table | Auth context |
| Account | A User's billing/subscription profile | `Account` model, `accounts` table | Billing context |
```

## Technique 2: Bounded Context Mapping

In DDD, the same term can mean different things in different contexts. The "Ubiquitous" in "Ubiquitous Language" is bounded — it applies *within* one context, not globally.

**Example:** An "Order" in the **Checkout** context means "pending payment." An "Order" in the **Fulfillment** context means "packed and shipped." These are different concepts that happen to share a name.

### When Contexts Conflict

| Option | When | Tradeoff |
|---|---|---|
| **Split the term** | Different behaviors, data, lifecycle | Clearer but more types to manage |
| **Keep one term, document the phases** | Same entity, different states | Simpler but confusion at boundaries |
| **Use sub-types** | Shared core with context-specific properties | Precise but more complex |

**Default:** Split the term if the two contexts never share code. Keep one term if they share a code path.

## Technique 3: Glossary as AI Context

This technique — from Matt Pocock's AI Engineer Summit talk — directly improves AI agent output:

1. **Extract** your glossary from the codebase (Technique 1)
2. **Format** it as a markdown table in your AGENTS.md or a dedicated `.md` file
3. **Persist** it — include it in every prompt or reference it from context files
4. **Read thinking traces** — when the LLM uses a term incorrectly, update the glossary

### Example: Glossary Section in AGENTS.md

```markdown
## Glossary

- **Order** = `src/orders/Order.ts` — purchase request in PENDING state
- **Invoice** = `src/billing/Invoice.ts` — billing record generated from Order
- **Shipment** = `src/fulfillment/Shipment.ts` — physical delivery of items
```

### Why This Works

Pocock observed that reading the model's thinking traces confirmed this technique:

- **Reduces verbose reasoning** — the AI doesn't have to infer what a term means from context
- **Aligns implementation with intent** — the AI uses the correct code symbols from the start
- **Prevents drift** — the glossary is extracted from truth (the codebase), not from conversation

## Technique 4: Detecting Language Drift

Over time, vocabulary naturally diverges. Watch for:

| Signal | What to do |
|---|---|
| AI generates a new term the codebase doesn't use | Update the glossary or rename the generated code |
| Two developers use different names for the same concept | Align on one name, update code and context |
| AGENTS.md mentions a term not found in code | Add the code symbol or remove the stale term |
| Same term used for different concepts in code | Refactor or split the type |
| PR review consistently corrects naming | Create a glossary entry and enforce it |

### Drift Check Frequency

- **Per sprint** — scan for new terms in code vs AGENTS.md
- **Per AI session** — check that AGENTS.md terms match the module you're working in
- **Per refactor** — regenerate the glossary when domain types change

## Output Checklist

- [ ] Glossary extracted from codebase: types, modules, routes, domain operations
- [ ] AGENTS.md vocabulary cross-referenced against code symbols
- [ ] Bounded contexts identified where same term has different meanings
- [ ] Glossary formatted and persisted for AI context
- [ ] Language drift signals documented for ongoing maintenance

## See Also

- **spec-driven-development** — Define vocabulary in the spec before implementation
- **deep-module-design** — Module boundaries align with bounded contexts
- **memory-system** — Persist glossary for cross-session AI context

## Skill Result Contract

```xml
<skill_result>
  <skill>ubiquitous-language</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Glossary generated, cross-references checked, bounded contexts mapped</evidence>
  <artifacts>Glossary file, AGENTS.md updates, detected drifts</artifacts>
  <risks>Unaligned terms deferred, contexts not fully mapped, or none</risks>
</skill_result>
```
