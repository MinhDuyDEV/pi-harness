# Session Start Protocol

**Every session, follow these steps:**

## Session Start Checklist

- [ ] Run `br ready` to find unblocked work
- [ ] If none, run `br list --status open` to see all open tasks
- [ ] Claim the task: `br update <id> --status in_progress`
- [ ] Load context: `br show <id>`

## Step 1: Find Ready Work

```bash
br ready
```

Returns highest priority task with no blockers.

If no tasks returned, check all open work:

```bash
br list --status open
```

## Step 2: Claim Task

```bash
br update <id> --status in_progress
```

## Step 3: Get Full Context

```bash
br show <id>
```

Shows full description, dependencies, notes, history.

## Step 4: Do the Work

Implement the task, adding notes as you learn.

## Step 5: Complete and Sync

```bash
br close <id> --reason "Implemented auth with JWT tokens"
br sync --flush-only
git add .beads/
git commit -m "sync beads"
# RESTART SESSION - fresh context
```

Always restart session after closing a task. One task per session.

## Session End Checklist

- [ ] Close the bead with a clear reason: `br close <id> --reason "..."`
- [ ] Sync Beads to JSONL: `br sync --flush-only`
- [ ] Commit `.beads/` changes manually
- [ ] Restart session (fresh context)
