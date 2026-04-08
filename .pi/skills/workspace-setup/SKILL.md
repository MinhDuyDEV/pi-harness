---
name: workspace-setup
description: >
  Use when a command needs to create a feature branch or set up a workspace for bead work. Shared by /create and /ship.
version: 1.0.0
tags: [git, workspace, branch, setup]
---

# Workspace Setup

Set up a git workspace (branch or worktree) for bead-based work.

## When to Use

- In `/create` after bead creation, before task conversion
- In `/ship` when auto-claiming an unclaimed bead
- Any command that needs to transition from "no workspace" to "active workspace"

## When NOT to Use

- If bead is already `in_progress` with an existing branch
- If user explicitly chose "Use current branch"

## Protocol

### Step 1: Ask the user

```typescript
question({
  questions: [
    {
      header: "Workspace",
      question: "How do you want to set up the workspace?",
      options: [
        {
          label: "Create feature branch (Recommended)",
          description: "git checkout -b <prefix>/<bead-id>-<title>",
        },
        {
          label: "Use current branch",
          description: "Work on current branch without creating a new one",
        },
      ],
    },
  ],
});
```

> **Note:** `/create` may additionally offer a "Create worktree" option using `skill({ name: "using-git-worktrees" })`.

### Step 2: Create branch (if selected)

Map bead type to branch prefix:

| Bead Type | Branch Prefix |
| --------- | ------------- |
| feature   | feat          |
| bug       | fix           |
| task      | task          |
| epic      | epic          |

Create the branch:

```bash
git checkout -b $PREFIX/$BEAD_ID-$TITLE_SLUG
```

Where `$TITLE_SLUG` is the bead title lowercased with spaces replaced by hyphens, truncated to ~50 chars.

### Step 3: Confirm

```bash
git branch --show-current
```

Verify you're on the new branch before proceeding.
