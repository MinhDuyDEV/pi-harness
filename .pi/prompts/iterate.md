---
description: Refine PRD mid-implementation when scope changes, discoveries emerge, or requirements pivot
argument-hint: "<bead-id> [--scope expand|reduce|pivot] [--reason <text>]"
---

# Iterate: $ARGUMENTS

Refine a bead's PRD during active implementation. Two-phase process: define what changed, then update spec artifacts and re-derive affected tasks.

> **When to use:** Mid-`/ship` when you discover scope changed, requirements shifted, or a technical discovery invalidates the original plan.
>
> **NOT for:** Pre-implementation changes (use `/create` to rewrite the PRD) or post-implementation retrospectives (use `/compound`).

## Load Skills

```typescript
skill({ name: "beads" });
skill({ name: "memory-grounding" });
skill({ name: "prd" });
skill({ name: "prd-task" });
```

## Parse Arguments

| Argument    | Default       | Description                        |
| ----------- | ------------- | ---------------------------------- |
| `<bead-id>` | required      | The bead being iterated            |
| `--scope`   | auto-detected | Change type: expand, reduce, pivot |
| `--reason`  | prompted      | Why the change is needed           |

## Before You Iterate

- **Be certain**: Only iterate if continuing with the current spec would produce wrong output
- **Don't over-iterate**: Minor adjustments don't need a full iterate cycle — just fix inline during `/ship`
- **Preserve progress**: Completed tasks stay completed unless explicitly invalidated
- **Document the delta**: Every change must be traceable to a reason

## Phase 1: Guards

```bash
br show $ARGUMENTS
```

Read `.beads/artifacts/$ARGUMENTS/` to check what artifacts exist.

Verify:

- Bead is `in_progress`
- `prd.md` exists
- Implementation is partially complete (at least 1 task done or in-progress)

If no tasks are started yet, redirect: "Use `/create --spec-only` to rewrite the PRD instead."

## Phase 2: Assess Change Type

If `--scope` was not provided, determine the change type:

| Type       | Signal                                                  | Example                                   |
| ---------- | ------------------------------------------------------- | ----------------------------------------- |
| **expand** | New requirement discovered, additional files needed     | "We also need to handle edge case X"      |
| **reduce** | Feature is over-scoped, some tasks are unnecessary      | "We don't need the admin panel after all" |
| **pivot**  | Fundamental approach changed, different solution needed | "REST won't work, switching to WebSocket" |

Ask user to confirm:

```typescript
question({
  questions: [
    {
      header: "Change Type",
      question: "What kind of spec change is this?",
      options: [
        { label: "Expand", description: "Adding scope — new requirements or files" },
        { label: "Reduce", description: "Removing scope — dropping unnecessary work" },
        { label: "Pivot", description: "Changing approach — different solution path" },
      ],
    },
  ],
});
```

## Phase 3: Define the Delta

### Step 1: Capture the change reason

If `--reason` was not provided, ask:

```typescript
question({
  questions: [
    {
      header: "Reason",
      question: "What triggered this change? (Be specific — this goes into the PRD changelog)",
      options: [],
    },
  ],
});
```

### Step 2: Identify affected artifacts

Read the current PRD and list:

- **Tasks completed:** (preserve these unless pivot invalidates them)
- **Tasks in-progress:** (may need modification)
- **Tasks not started:** (may need modification, removal, or replacement)
- **New tasks needed:** (for expand/pivot)

### Step 3: Document the delta

Write a change record to `.beads/artifacts/$ARGUMENTS/iterations.md`:

```markdown
## Iteration [N] — [date]

**Type:** [expand | reduce | pivot]
**Reason:** [user-provided reason]
**Triggered by:** [discovery | user request | technical constraint | external dependency]

### Impact Assessment

| Area  | Before                  | After                     | Action                         |
| ----- | ----------------------- | ------------------------- | ------------------------------ |
| Scope | [original scope]        | [new scope]               | [expanded/reduced/pivoted]     |
| Tasks | [N] total, [M] complete | [N'] total, [M] preserved | [added/removed/modified count] |
| Files | [original file list]    | [updated file list]       | [new/removed files]            |

### Task Changes

- **Preserved:** [list of completed task titles — unchanged]
- **Modified:** [list of tasks with what changed]
- **Removed:** [list of tasks marked obsolete, with reason]
- **Added:** [list of new tasks]
```

## Phase 4: Apply Changes

### For Expand:

1. Add new sections/requirements to `prd.md`
2. Add new tasks at the end of the Tasks section
3. Mark new tasks with `depends_on` referencing completed tasks if needed
4. Re-run `prd-task` skill to regenerate `prd.json` with merged task state

### For Reduce:

1. Move removed scope items to "Out-of-Scope" in `prd.md` with note: `[Removed in Iteration N: reason]`
2. Mark affected tasks by changing their heading from `### Task Title [category]` to `### ~~Task Title~~ [OBSOLETE — Iteration N]` in `prd.md` (don't delete — preserve history). The `prd-task` skill skips headings containing `OBSOLETE` or `INVALIDATED` markers.
3. Re-run `prd-task` to regenerate `prd.json` (obsolete tasks excluded)

### For Pivot:

1. Archive current PRD section as `## Original Approach (Superseded)` at bottom of file
2. Rewrite affected sections (Proposed Solution, Requirements, Tasks)
3. Preserve completed tasks that are still valid
4. Mark invalidated completed tasks by changing their heading to `### ~~Task Title~~ [INVALIDATED — Iteration N: reason]`
5. Re-run `prd-task` to regenerate `prd.json`

### Update plan.md (if exists):

If `.beads/artifacts/$ARGUMENTS/plan.md` exists:

1. Add an "## Iteration [N] Changes" section to the plan
2. Update dependency graph if tasks changed
3. Re-compute waves for remaining tasks

## Phase 5: Validate

After applying changes:

- [ ] PRD has no `[NEEDS CLARIFICATION]` markers (resolve or add to Open Questions)
- [ ] All preserved completed tasks are still valid
- [ ] New/modified tasks have verification steps
- [ ] `iterations.md` documents the full delta
- [ ] `prd.json` reflects the updated task state

## Phase 6: Report

```bash
br comments add $ARGUMENTS "Iteration [N]: [type] — [reason summary]. Tasks: [added/removed/modified] count"
```

Output:

1. **Change type:** [expand | reduce | pivot]
2. **Reason:** [brief summary]
3. **Task changes:** [N] preserved, [M] modified, [K] removed, [J] added
4. **Files affected:** [updated list]
5. **Iteration log:** `.beads/artifacts/$ARGUMENTS/iterations.md`
6. **Next step:** Continue `/ship $ARGUMENTS` with updated spec

## Related Commands

| Need                       | Command            |
| -------------------------- | ------------------ |
| Create initial spec        | `/create`          |
| Continue shipping          | `/ship <id>`       |
| Review after changes       | `/review-codebase` |
| Post-implementation review | `/compound <id>`   |
