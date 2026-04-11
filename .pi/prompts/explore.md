---
description: Think through an idea with structured alternatives before committing to a change
argument-hint: "<idea or question>"
agentType: planner
---

# Explore: $ARGUMENTS

Think through an idea, problem, or approach with structured alternatives and tradeoffs — before committing to a bead or plan.

> **Workflow:** **`/explore`** → `/create` (if worth pursuing) or discard
>
> Use when you're not sure WHAT to build or HOW to approach it. This is ideation with rigor, not open-ended brainstorming.
>
> **When to use:** Before `/create`, when the approach isn't obvious. Skip for clear, well-scoped work.

## Load Skills

```typescript
skill({ name: "brainstorming" }); // Collaborative refinement
skill({ name: "memory-grounding" }); // Load past decisions
```

## Phase 1: Ground

Search for prior art and past decisions:

```typescript
memory_search({ query: "<topic keywords>", limit: 5 });
```

```bash
# What exists in the codebase already?
git log --oneline -20 | grep -i "<keyword>"
```

Spawn an explore agent to understand the current state:

```typescript
task({
  subagent_type: "explore",
  description: "Map existing patterns for this area",
  prompt: `Search the codebase for existing implementations, patterns, and conventions related to: $ARGUMENTS

  Return: what exists today, what patterns are used, what files are involved.`,
});
```

## Phase 2: Frame the Problem

Before proposing solutions, state the problem clearly:

1. **What's the goal?** (outcome, not task)
2. **What constraints exist?** (tech stack, time, compatibility, user preferences)
3. **What's the risk of doing nothing?** (is this urgent or nice-to-have?)

If the problem isn't clear after reading context, ask the user to clarify — but max 2 questions.

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

**Rules for alternatives:**

- At least one must be the simplest viable option
- At least one must be different in kind, not just degree (different architecture, not just different library)
- Don't pad with bad options to make the recommended one look good

## Phase 4: Recommend

Pick one approach and explain why:

```markdown
## Recommendation

**Approach:** [Name]
**Effort:** [S/M/L/XL]
**Why:** [2-3 sentences — why this over the others]
**When to reconsider:** [What signals would make you switch to an alternative]
```

## Phase 5: Output Proposal

Write the proposal as a structured document:

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

- **How:** ...
- **Pros:** ...
- **Cons:** ...
- **Effort:** S/M/L/XL

### Option C: [Name] (if applicable)

...

## Recommendation

**Option [X]** because [reasoning].
**Reconsider if:** [triggers for switching]

## Next Step

`/create "[description based on chosen approach]"`
```

**If a bead exists:** Save to `.beads/artifacts/$BEAD_ID/exploration.md`
**If no bead:** Display inline, don't create files.

## Phase 6: Ask User

Present the proposal and ask:

```typescript
question({
  questions: [
    {
      header: "Approach",
      question: "Which approach do you want to pursue?",
      options: [
        { label: "Option A (Recommended)", description: "[brief]" },
        { label: "Option B", description: "[brief]" },
        { label: "Option C", description: "[brief]" },
        { label: "None — need more research", description: "Spawn scout agents" },
      ],
    },
  ],
});
```

If user picks an approach → suggest `/create "[description]"` with the chosen approach baked in.
If user wants more research → spawn `@scout` for the specific unknowns.

## Related Commands

| Need                      | Command                             |
| ------------------------- | ----------------------------------- |
| Commit to an approach     | `/create`                           |
| Research external options | `/research`                         |
| Open-ended ideation       | Load `brainstorming` skill directly |
