---
description: Start working on a bead - claim it and prepare workspace
---

# Start: $@

Claim a task and prepare workspace. Bridge between specification (`/create`) and implementation (`/ship`).

> **Workflow:** `/create` → **`/start <id>`** → `/ship <id>`
>
> ⛔ Bead MUST have `prd.md` (created via `/create`).

## Parse Arguments

| Argument     | Default  | Description                  |
| ------------ | -------- | ---------------------------- |
| `<bead-id>`  | required | The bead to start            |
| `--worktree` | false    | Create isolated git worktree |

## Determine Input Type

| Input Type | Detection                   | Action                  |
| ---------- | --------------------------- | ----------------------- |
| Bead ID    | Matches `br-xxx` or numeric | Start that bead         |
| Path       | File/directory path         | Not supported for start |

## Before You Start

- **Be certain**: Only start beads with valid PRD (check Phase 2)
- **Check workspace**: Don't start if uncommitted changes exist (Phase 1)
- **One task at a time**: Warn if other tasks in progress
- **Validate spec**: Verify prd.md exists and has real content

## Phase 1: Pre-flight

```bash
git status --porcelain
git branch --show-current
br list --status=in_progress
```

- If uncommitted changes: ask user to stash, commit, or continue
- If other tasks in progress: warn before claiming another

## Phase 2: Validate Specification

```bash
br show $@
ls .beads/artifacts/$@/
```

Verify `prd.md` exists and has real content (not just placeholders). If missing or incomplete, tell user to run `/create` first.

## Phase 3: Claim

```bash
br update $@ --status in_progress
```

## Phase 4: Prepare Workspace

Choose the appropriate workspace strategy based on the task:

- **Create feature branch (Recommended):** `git checkout -b feat/<bead-id>-<title>` — best for isolated work
- **Use current branch:** Continue without branch creation — suitable for quick fixes
- **Create worktree:** Isolated git worktree — use when `--worktree` flag was passed

**If feature branch selected:**

```bash
git checkout -b feat/$@-$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
```

**If worktree requested:** Create an isolated worktree directory for this bead (e.g., `../worktrees/<bead-id>`), then work inside it.

**If current branch:** Continue without branch creation.

## Phase 5: Convert PRD to Tasks

If `prd.json` doesn't exist yet, parse the PRD markdown and convert tasks to executable JSON format. Each task should have: title, description, files, verification commands, and dependency metadata.

If `prd.json` already exists, show progress (completed/total tasks).

## Phase 6: Report and Route

Output:

1. Bead type and status
2. Branch name
3. Workspace (main or worktree)
4. Artifact status (prd.md validated, prd.json exists/created)
5. Next step recommendation

| State              | Next Command             |
| ------------------ | ------------------------ |
| Has prd.json       | `/ship $@`               |
| Epic with subtasks | `/start <first-subtask>` |
| Complex task       | `/plan $@`               |

## Related Commands

| Need                | Command      |
| ------------------- | ------------ |
| Create spec first   | `/create`    |
| Plan implementation | `/plan <id>` |
| Implement and ship  | `/ship <id>` |
