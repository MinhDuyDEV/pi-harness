---
description: Refine PRD mid-implementation when scope changes or discoveries emerge
argument-hint: "<bead-id> [--scope expand|reduce|pivot] [--reason <text>]"
---

# Iterate: $ARGUMENTS

Refine a bead's PRD during active implementation. Two-phase process: define what changed, then update spec artifacts and re-derive affected tasks.

> **When to use:** Mid-`/ship` when you discover scope changed, requirements shifted, or a technical discovery invalidates the original plan.
>
> **NOT for:** Pre-implementation changes (use `/create` to rewrite) or post-implementation retrospectives (use `/compound`).

## Parse Arguments

| Argument    | Default       | Description                        |
| ----------- | ------------- | ---------------------------------- |
| `<bead-id>` | required      | The bead being iterated            |
| `--scope`   | auto-detected | Change type: expand, reduce, pivot |
| `--reason`  | prompted      | Why the change is needed           |

## Before You Iterate

- Only iterate if continuing with the current spec would produce wrong output
- Minor adjustments don't need a full iterate cycle — just fix inline during `/ship`
- Preserve progress: completed tasks stay completed unless explicitly invalidated
- Document the delta: every change must be traceable to a reason

## Phase 1: Guards

```bash
br show $ARGUMENTS
```

Verify:
- Bead is `in_progress`
- `prd.md` exists
- Implementation is partially complete (at least 1 task done or in-progress)

If no tasks started yet, redirect: "Use `/create --spec-only` to rewrite the PRD instead."

## Phase 2: Assess Change Type

| Type       | Signal                                                  | Example                                   |
| ---------- | ------------------------------------------------------- | ----------------------------------------- |
| **expand** | New requirement discovered, additional files needed     | "We also need to handle edge case X"      |
| **reduce** | Feature is over-scoped, some tasks are unnecessary      | "We don't need the admin panel after all" |
| **pivot**  | Fundamental approach changed, different solution needed | "REST won't work, switching to WebSocket" |

## Phase 3: Define the Delta

1. Capture the change reason
2. Identify affected artifacts:
   - **Tasks completed:** (preserve unless pivot invalidates)
   - **Tasks in-progress:** (may need modification)
   - **Tasks not started:** (may need modification, removal, or replacement)
   - **New tasks needed:** (for expand/pivot)
3. Document to `iterations.md`

## Phase 4: Apply Changes

### For Expand:
- Add new requirements to `prd.md`
- Add new tasks with dependencies on completed tasks

### For Reduce:
- Move removed scope to "Out-of-Scope" with note: `[Removed in Iteration N: reason]`
- Mark affected tasks as `OBSOLETE`

### For Pivot:
- Archive current approach as `## Original Approach (Superseded)`
- Rewrite affected sections
- Preserve still-valid completed tasks
- Mark invalidated tasks as `INVALIDATED`

### Update plan.md (if exists):
- Add "Iteration N Changes" section
- Update dependency graph
- Re-compute waves for remaining tasks

## Phase 5: Validate

- [ ] PRD has no unresolved clarification markers
- [ ] All preserved completed tasks are still valid
- [ ] New/modified tasks have verification steps
- [ ] `iterations.md` documents the full delta

## Phase 6: Report

Output:

1. **Change type:** [expand | reduce | pivot]
2. **Reason:** [brief summary]
3. **Task changes:** [N] preserved, [M] modified, [K] removed, [J] added
4. **Files affected:** [updated list]
5. **Next step:** Continue `/ship $ARGUMENTS` with updated spec

## Related Commands

| Need                       | Command            |
| -------------------------- | ------------------ |
| Create initial spec        | `/create`          |
| Continue shipping          | `/ship <id>`       |
| Review after changes       | `/review-codebase` |
| Post-implementation review | `/compound <id>`   |
