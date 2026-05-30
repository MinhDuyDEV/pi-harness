---
description: Think through an idea with structured alternatives before committing to a change
argument-hint: "<idea or question>"
agentType: planner
---

# Explore: $ARGUMENTS

Think through an idea, problem, or approach with structured alternatives and tradeoffs before creating a file-backed work plan.

> **Workflow:** `/explore` → `/create` if worth pursuing, or discard.

## Load Skills

```typescript
skill({ name: "brainstorming" });
skill({ name: "memory-system" });
```

## Phase 1: Ground

Search prior art and current code directly:

```typescript
memory-search({ query: "<topic keywords>", limit: 5 });
```

```bash
git log --oneline -20 | grep -i "<keyword>" || true
srcwalk overview . 2>/dev/null || true
srcwalk discover "$ARGUMENTS" 2>/dev/null || true
```

Return what exists today, patterns used, and files involved. If exploration is large enough to deserve fresh context, write `.pi/plans/<id>/EXPLORE-BRIEF.md` and explicitly run tmux/`pi --print-turn`; require `.pi/plans/<id>/EXPLORATION.md` as output before trusting it.

## Phase 2: Frame the Problem

State:

1. **Goal** — outcome, not task.
2. **Constraints** — stack, compatibility, time, user preferences.
3. **Risk of doing nothing** — urgency vs nice-to-have.

If context is still unclear, ask at most two targeted questions.

## Phase 3: Generate Alternatives

Produce 2-3 approaches.

| Aspect | What to Cover |
| --- | --- |
| Approach | 1-2 sentence summary |
| How | 3-5 implementation steps |
| Pros | What this gets right |
| Cons | What this worsens or complicates |
| Effort | S (<1h), M (1-3h), L (1-2d), XL (>2d) |
| Risk | What could go wrong |

Rules:

- Include the simplest viable option.
- Include at least one meaningfully different option.
- Do not pad with bad options.

## Phase 4: Recommend

```markdown
## Recommendation

**Approach:** [Name]
**Effort:** [S/M/L/XL]
**Why:** [2-3 sentences]
**When to reconsider:** [signals that would change the decision]
```

## Phase 5: Output Proposal

```markdown
# Exploration: [Topic]

## Problem
[What we're trying to solve]

## Constraints
- ...

## Alternatives
### Option A: [Name]
- **How:** ...
- **Pros:** ...
- **Cons:** ...
- **Effort:** ...

### Option B: [Name]
...

## Recommendation
**Option [X]** because ...

## Next Step
`/create "[description based on chosen approach]"`
```

If a matching work directory already exists, save to `.pi/plans/<id>/EXPLORATION.md`; otherwise display inline and do not create files unless the user asks.

## Phase 6: Ask User

Present the proposal and ask which approach to pursue. If none is ready, recommend `/research <specific-question>`.

## Related Commands

| Need | Command |
| --- | --- |
| Commit to an approach | `/create` |
| Research external options | `/research` |
| Plan details | `/plan <id>` |
