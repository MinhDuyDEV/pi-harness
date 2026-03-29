---
name: sprint-think
description: Use during sprint Think phase to deeply analyze a problem with forcing questions, landscape research, and structured design doc output.
version: 1.0.0
tags: [workflow, sprint, research, design]
dependencies: [brainstorming]
---

# Sprint Think

## When to Use
- First phase of a sprint — problem analysis before any planning or coding
- You need to validate assumptions before committing to an approach
- The problem space is ambiguous or has multiple valid solutions
- Upgrading a brainstorming session into a rigorous design doc

## When NOT to Use
- Problem is already well-understood with an approved design doc
- Quick bug fix where root cause is clear
- You're resuming a sprint that already completed Think phase

## Overview

Think is the forcing-function phase. It prevents the most expensive mistake in engineering: building the wrong thing. Output is a design doc at `.beads/sprints/<sprint-id>/design.md` using template `.pi/templates/sprint-design.md`.

**Core principle**: No code, no plans — only understanding. Think produces a design doc, never implementation.

## The Process

### Step 0: Load Context
```
memory-search({ query: "<sprint title>", type: "all" })
```
Read any prior design docs, related beads, or existing code in the area.

### Step 1: Research Layer

Spawn both research agents in parallel:
```typescript
task({
  subagent_type: "scout",
  description: "Landscape research for sprint",
  prompt: "Research: <problem statement>. Find: (1) existing solutions/libraries, (2) prior art in this codebase, (3) industry patterns. Return findings with citations.",
  run_in_background: true
})
```

```typescript
task({
  subagent_type: "explore",
  description: "Codebase context mapping",
  prompt: "Find all code related to <problem area>. Map: existing patterns, interfaces, dependencies, test coverage.",
  run_in_background: true
})
```

Await both results before proceeding to Step 2.

### Step 2: Six Forcing Questions

Ask these ONE AT A TIME. Each question must be answered before proceeding.

**Q1 — Demand Reality**
> Is anyone desperate for this? Who specifically? What evidence do we have?

Probe for: real user requests, error logs, support tickets, metrics showing pain. If the answer is "it would be nice" — challenge whether this sprint should exist.

**Q2 — Status Quo**
> What do people do today without this? Why is that painful enough to change?

Map the current workaround. If the workaround is tolerable, the feature may not be worth building.

**Q3 — Narrowest Wedge**
> What is the smallest version that delivers value? Can we cut scope by 50%?

Push hard here. The first answer is almost never narrow enough. Ask: "What if we had to ship this in 1 day instead of 1 week?"

**Q4 — Existing Solutions**
> What already exists? Why build instead of use/extend? What's our unfair advantage?

Cross-reference with scout research. If something exists that's 80% of what we need, extending it beats building from scratch.

**Q5 — Observation & Surprise**
> What unexpected thing did we discover during research that changes our approach?

Force a non-obvious insight. If the answer is "nothing surprising" — the research wasn't deep enough.

**Q6 — Future-Fit**
> Does this compound over time or is it a one-off? What does this unlock next?

Prefer approaches that create leverage for future work over dead-end solutions.

### Step 3: Premise Challenge

Extract 3 core premises from the emerging approach. Present them for explicit agreement:

```
question({
  questions: [{
    header: "Premises",
    question: "This approach assumes these premises hold. Agree or challenge:",
    options: [
      { label: "All premises valid", description: "Proceed with current approach" },
      { label: "Challenge premise 1", description: "<premise text>" },
      { label: "Challenge premise 2", description: "<premise text>" },
      { label: "Challenge premise 3", description: "<premise text>" }
    ]
  }]
})
```

If a premise is challenged: revisit the forcing question it came from, explore alternatives.

### Step 4: Mandatory Alternatives

Present 2-3 approaches. NEVER present a single option.

| # | Approach | Effort | Risk | Trade-offs |
|---|----------|--------|------|------------|
| 1 | [Recommended] | S/M/L/XL | Low/Med/High | [Gains and losses] |
| 2 | [Alternative] | S/M/L/XL | Low/Med/High | [Gains and losses] |
| 3 | [Radical] | S/M/L/XL | Low/Med/High | [Gains and losses] |

Classify the choice: is this Mechanical, Taste, or User Challenge?

### Step 5: Write Design Doc

Fill `.pi/templates/sprint-design.md` with all findings. Save to `.beads/sprints/<sprint-id>/design.md`.

### Step 6: Gate — User Approval

Present the design doc summary and ask:

```
question({
  questions: [{
    header: "Design Gate",
    question: "Design doc complete. How to proceed?",
    options: [
      { label: "Approve — move to Plan", description: "Design is solid, proceed to planning" },
      { label: "Revise — need changes", description: "Specific feedback on what to change" },
      { label: "Reject — wrong direction", description: "Start over with different approach" }
    ]
  }]
})
```

On approval: update sprint state `think.status = "completed"`, set `gates.think-approved = true`.

## Anti-Patterns

- **Sycophancy**: Never say "interesting approach" or "that could work." Take positions. If the idea has a flaw, name it.
- **Premature solution**: Don't jump to "here's how to build it" before Q1-Q6 are answered.
- **Research theater**: Surface-level search isn't research. Dig into actual code, actual docs, actual usage patterns.
- **Single option**: Always present alternatives. "There's only one way" is almost never true.

## After Think
Design approved → Load `/skill:sprint-plan` to create implementation plan.
