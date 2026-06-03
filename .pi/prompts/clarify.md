---
description: Reduce ambiguity before planning or implementation
argument-hint: "<request-or-work-id> [--quick|--deep]"
---

# Clarify: $ARGUMENTS

Reduce ambiguity before planning or implementation. Use this when the request is real but still fuzzy.

## Load Skills

```typescript
skill({ name: "brainstorming" });
skill({ name: "source-driven-development" });
```

## Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<request-or-work-id>` | required | Freeform request text or a directory under `.pi/artifacts/` |
| `--quick` | false | Ask the smallest set of questions needed to choose the next command |
| `--deep` | false | Clarify non-goals, risks, interfaces, and success criteria before handoff |

If both flags appear, `--deep` wins.

## When to Use

- Scope, constraints, or success criteria are unclear.
- Multiple plausible interpretations would lead to different implementations.
- `/plan` would be premature because a main decision is unresolved.

## When Not to Use

- The request is already specific enough to plan directly.
- The task is mechanical and local.
- The ambiguity is only about repo facts you can inspect yourself.

## Core Rules

- Inspect first, ask second.
- Ask only questions that change the plan.
- Prefer structured choices.
- Surface non-goals explicitly.
- Stop once the next command is obvious.

## Phase 1: Ground

1. Identify unknowns blocking execution.
2. If `$ARGUMENTS` maps to `.pi/artifacts/$ARGUMENTS/`, read available artifacts:
   - `SPEC.md`
   - `PLAN.md`
   - `RESEARCH.md`
   - `PROGRESS.md`
3. Inspect repo/docs/memory before asking the user for facts.
4. Classify unknowns:
   - **Scope** — included/excluded work.
   - **Constraint** — compatibility, timeline, safety, tooling.
   - **Success** — proof of completion.
   - **Preference** — valid options requiring user choice.

## Phase 2: Clarify

Ask the smallest useful question first.

Good targets:

- Which user-visible outcome matters most?
- What must remain unchanged?
- Which tradeoff wins: speed, safety, simplicity, or completeness?
- Is there an existing artifact, issue, screenshot, or spec that controls scope?

Bad targets:

- Repo facts you can inspect.
- Bundled multi-part questions.
- Questions that do not alter the plan.

## Phase 3: Converge

After each answer, update:

```markdown
## Clarified So Far
- Goal:
- Non-goals:
- Constraints:
- Success criteria:
- Open questions:
```

Stopping thresholds:

- Default: stop when the next command is obvious.
- `--quick`: stop as soon as one clear path wins.
- `--deep`: continue until non-goals, constraints, and success criteria are explicit.

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
- `/create "..."` to create/update a file-backed spec
- `/plan <id>` when execution needs sequencing
- `/research <topic-or-id>` when external facts are missing
- `/ship <id>` when execution can begin
```

## Success Criteria

- Questions were necessary and targeted.
- Repo facts were inspected directly.
- Non-goals and constraints are explicit.
- The next command is obvious.
