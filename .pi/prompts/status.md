---
description: Show project status - tasks, git state, recent sessions
---

# Status: $@

Quick project status dashboard. Runs read-only commands and reports state.

> **No arguments required.** Flags are optional filters.

## Parse Arguments

| Argument     | Default | Description             |
| ------------ | ------- | ----------------------- |
| `--git`      | false   | Focus on git state only |
| `--sessions` | false   | Focus on sessions only  |

## Determine Input Type

| Input Type   | Detection     | Action              |
| ------------ | ------------- | ------------------- |
| No arguments | Default       | Show full dashboard |
| `--git`      | Flag provided | Git state only      |
| `--sessions` | Flag provided | Sessions only       |

## Before You Status

- **Be certain**: This is a read-only command, no changes are made
- **Use actual data**: Don't invent data, use real command output
- **No modifications**: Don't create beads or modify state from status
- **Single recommendation**: Only suggest ONE next action

## Phase 1: Gather State

Run all checks:

```bash
br stats
br list --status in_progress
br ready
```

```bash
git status --porcelain
git branch --show-current
git log --oneline -5
```

Check the bead comments and recent handoff files for any session context:

```bash
ls .beads/artifacts/*/handoffs/ 2>/dev/null | sort | tail -5
```

---

## Phase 2: Format Report

Present results in simple sections. Use the actual output from Phase 1 — don't invent data.

```
Status
━━━━━━

TASKS
  In Progress: [list from br list --status in_progress]
  Ready:       [list from br ready]
  Stats:       [summary from br stats]

GIT
  Branch:  [from git branch]
  Changes: [from git status, or "clean"]
  Recent:  [from git log]

RECENT HANDOFFS
  [from handoff files, or "None found"]
```

---

## Phase 3: Suggest Next Action

Based on gathered state, recommend ONE next step:

| State                        | Suggestion                    |
| ---------------------------- | ----------------------------- |
| Has in_progress tasks        | `/ship <id>` (continue work)  |
| Has ready tasks, none active | `/start <id>` (pick up work)  |
| Uncommitted changes          | Review and commit             |
| Nothing active or ready      | `/create "<desc>"` (new work) |

---

## Output

```
Status
━━━━━━

[Sections from Phase 2]

Next: [single recommendation from Phase 3]
```
