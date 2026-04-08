---
description: Think through an idea with structured alternatives before committing to a change
argument-hint: "<idea or question>"
---

# Explore: $ARGUMENTS

Think through an idea, problem, or approach with structured alternatives and tradeoffs — before committing to a bead or plan.

> **Workflow:** **`/explore`** → `/create` (if worth pursuing) or discard
>
> Use when you're not sure WHAT to build or HOW to approach it. This is ideation with rigor, not open-ended brainstorming.

## Phase 1: Ground

Search for prior art and past decisions:

```
memory-search(query: "<topic keywords>", limit: 5)
```

Spawn an explore agent to understand the current state of the codebase for this area.

## Phase 2: Frame the Problem

Before proposing solutions, state clearly:

1. **What's the goal?** (outcome, not task)
2. **What constraints exist?** (tech stack, time, compatibility)
3. **What's the risk of doing nothing?** (urgent or nice-to-have?)

If the problem isn't clear after reading context, ask the user to clarify — max 2 questions.

## Phase 3: Generate Alternatives

Produce 2-3 approaches. For each:

| Aspect       | What to Cover                          |
| ------------ | -------------------------------------- |
| **Approach** | 1-2 sentence summary                   |
| **How**      | Key implementation steps (3-5 bullets) |
| **Pros**     | What this gets right                   |
| **Cons**     | What this gets wrong or makes harder   |
| **Effort**   | S (<1h), M (1-3h), L (1-2d), XL (>2d)  |
| **Risk**     | What could go wrong                    |

**Rules:**
- At least one must be the simplest viable option
- At least one must be different in kind, not just degree
- Don't pad with bad options to make the recommended one look good

## Phase 4: Recommend

```markdown
## Recommendation

**Approach:** [Name]
**Effort:** [S/M/L/XL]
**Why:** [2-3 sentences — why this over the others]
**When to reconsider:** [What signals would make you switch]
```

## Phase 5: Output Proposal

```markdown
# Exploration: [Topic]

## Problem
[What we're trying to solve]

## Constraints
- [Constraint 1]
- [Constraint 2]

## Alternatives

### Option A: [Name]
- **How:** ...
- **Pros:** ...
- **Cons:** ...
- **Effort:** S/M/L/XL

### Option B: [Name]
...

## Recommendation
**Option [X]** because [reasoning].
**Reconsider if:** [triggers for switching]

## Next Step
`/create "[description based on chosen approach]"`
```

## Phase 6: Ask User

Present the proposal and ask which approach to pursue.

If user picks an approach → suggest `/create "[description]"` with the chosen approach baked in.
If user wants more research → delegate to scout for specific unknowns.

## Related Commands

| Need                      | Command      |
| ------------------------- | ------------ |
| Commit to an approach     | `/create`    |
| Research external options | `/research`  |
