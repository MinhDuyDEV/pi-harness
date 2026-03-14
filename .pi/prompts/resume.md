---
description: Resume work on a bead from previous session
---

# Resume: $@

Pick up where a previous session left off. Recover context, verify state, continue.

## Phase 1: Verify Task

```bash
br show $@
```

If not found, check `br list --status=all` — it may have been closed or the ID is wrong.

## Phase 2: Git State

```bash
git branch --show-current
git status --porcelain
```

If not on the right branch, check out the feature branch. If uncommitted changes exist, ask user what to do.

## Phase 3: Find Handoff

Check for handoff notes:

```bash
ls .beads/artifacts/$@/handoffs/ 2>/dev/null
```

If a handoff exists, read the latest one. It tells you:

- What was completed
- Where work stopped
- What to do next
- Any blockers

If no handoff file is found, review the git log and bead comments for context on where work stopped.

## Phase 4: Load Artifacts

Read all available context:

- `.beads/artifacts/$@/prd.md`
- `.beads/artifacts/$@/plan.md` (if exists)
- `.beads/artifacts/$@/progress.txt` (if exists)
- `.beads/artifacts/$@/research.md` (if exists)

## Phase 5: Check Staleness

If handoff is more than 3 days old:

```bash
git log --oneline -10
```

Check if significant changes happened on main. If so, consider rebasing. Don't blindly follow an outdated plan — verify it still makes sense.

## Phase 6: Continue

```bash
br update $@ --status in_progress
```

Report:

1. Branch and commit
2. Handoff age
3. Progress (completed/remaining tasks)
4. Next action (from handoff or PRD)

Then continue with `/ship $@` or `/plan $@` as appropriate.
