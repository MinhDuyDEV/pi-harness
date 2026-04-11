---
description: Resume work on a bead from previous session
argument-hint: "<bead-id>"
---

# Resume: $ARGUMENTS

Pick up where a previous session left off. Recover context, verify state, continue.

## Load Skills

```typescript
skill({ name: "beads" });
skill({ name: "memory-grounding" });
```

## Phase 1: Verify Task

```bash
br show $ARGUMENTS
```

If not found, check `br list --status=all` — it may have been closed or the ID is wrong.

## Phase 2: Git State

```bash
git branch --show-current
git status --porcelain
```

If not on the right branch, check out the feature branch. If uncommitted changes exist, ask user what to do.

## Phase 3: Find Handoff

Follow the [memory-grounding](../skill/memory-grounding/SKILL.md) skill protocol. Focus on: handoff file by bead ID, session history.

If a handoff exists, it tells you:

- What was completed
- Where work stopped
- What to do next
- Any blockers

## Phase 4: Load Artifacts

Read all available context:

- `.beads/artifacts/$ARGUMENTS/prd.md`
- `.beads/artifacts/$ARGUMENTS/plan.md` (if exists)
- `.beads/artifacts/$ARGUMENTS/progress.txt` (if exists)
- `.beads/artifacts/$ARGUMENTS/research.md` (if exists)

## Phase 5: Check Staleness

If handoff is more than 3 days old:

```bash
git log --oneline -10
```

Check if significant changes happened on main. If so, consider rebasing. Don't blindly follow an outdated plan — verify it still makes sense.

## Phase 6: Continue

```bash
br update $ARGUMENTS --status in_progress
```

Report:

1. Branch and commit
2. Handoff age
3. Progress (completed/remaining tasks)
4. Next action (from handoff or PRD)

Then continue with `/ship $ARGUMENTS` or `/plan $ARGUMENTS` as appropriate.
