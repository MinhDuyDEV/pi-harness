---
description: Reduce ambiguity before planning or implementation
argument-hint: "<request or bead-id> [--quick|--deep]"
---

# Clarify: $ARGUMENTS

Reduce ambiguity before planning or implementation. Use this when the request is real but still fuzzy.

## Load Skills

```typescript
skill({ name: "beads" });
skill({ name: "brainstorming" });
skill({ name: "source-code-research" });
```

## Parse Arguments

| Argument | Default | Description |
| -------- | ------- | ----------- |
| `<request or bead-id>` | required | Freeform request text or an existing bead ID |
| `--quick` | false | Minimize clarification to the smallest set of questions needed to choose the next command |
| `--deep` | false | Expand clarification to cover non-goals, risks, interfaces, and success criteria before handoff |

**Mode rules:**
- Default mode: ask only enough to make the next command obvious
- `--quick`: aim to stop after 1-3 high-leverage questions
- `--deep`: keep going until scope, non-goals, constraints, and success criteria are all explicit
- If both flags appear, `--deep` wins

## When to Use

- The request has unclear scope, constraints, or success criteria
- There are multiple plausible interpretations of what "done" means
- You can feel yourself wanting to assume instead of verify
- `/plan` would be premature because the main branch decision is still unresolved

## When NOT to Use

- The request is already specific enough to plan directly
- The task is purely mechanical and local
- The ambiguity is only about codebase facts you can inspect yourself

## Core Rules

- **Inspect first, ask second** — never ask the user for codebase facts you can discover directly
- **One question at a time** — each question must reduce a real ambiguity
- **Prefer structured choices** when possible
- **Surface non-goals explicitly** — what should *not* change is often as important as what should
- **Stop once the next command is obvious** — don't turn clarification into therapy

## Process

### Phase 1: Ground

1. Read the request and identify the unknowns blocking execution
2. If `$ARGUMENTS` is a bead ID, ground yourself first:
   - `br show $ARGUMENTS`
   - `ls .beads/artifacts/$ARGUMENTS/`
   - read existing PRD / design / plan artifacts before asking anything
3. Inspect the repo, docs, memory, and existing plans before asking anything
4. Classify unknowns into:
   - **Scope** — what is included/excluded
   - **Constraint** — compatibility, timeline, safety, tooling
   - **Success** — how we know we're done
   - **Preference** — valid options where the user should choose

### Phase 2: Clarify

Ask the smallest useful question first.

Good targets:
- Which user-visible outcome matters most?
- What must remain unchanged?
- Which trade-off wins: speed, safety, simplicity, or completeness?
- Is there an existing artifact (PRD, issue, spec, screenshot) that should control scope?

Bad targets:
- "Where is X implemented?" when you can inspect the repo
- Three questions in one message
- Questions that don't change the plan

### Phase 3: Converge

After each answer, update the current picture:

```markdown
## Clarified So Far
- Goal:
- Non-goals:
- Constraints:
- Success criteria:
- Open questions:
```

If two or more material ambiguities remain, continue.
If one or zero remain, stop and route forward.

**Stopping thresholds:**
- Default: stop when the next command is obvious
- `--quick`: stop as soon as one clear path wins
- `--deep`: do not stop until non-goals, constraints, and success criteria are all explicit

## Output

End with a concise **Clarity Brief**:

```markdown
# Clarity Brief

## Goal
- ...

## Non-goals
- ...

## Constraints
- ...

## Success Criteria
- ...

## Remaining Open Questions
- ...

## Recommended Next Command
- `/plan ...` when implementation should be planned
- `/research ...` when external facts are missing
- `/start ...` when execution can begin directly
```

## Success Criteria

- You asked only questions that materially changed direction
- You did not ask the user for repo facts you could inspect yourself
- Non-goals and constraints are explicit
- The next recommended command is obvious
