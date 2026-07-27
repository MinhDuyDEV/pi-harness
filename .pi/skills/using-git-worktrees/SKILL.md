---
name: using-git-worktrees
description: Git worktree workflow — isolated sibling working copies per branch, PR review in detached worktrees, cleanup via prune. Use when work needs isolation, or when testing a PR without disrupting the working copy.
metadata:
  version: 1.0.0
  tags:
  - git
  - workflow
  dependencies: []
---

# Git Worktrees

## When to Use

Starting a feature that needs isolation from current workspace; multi-agent work in same repo; long-running branch that doesn't conflict with main; need to test a PR without disrupting the working copy; switching between contexts without `git stash`; running CI / tests in parallel.

## When NOT to Use

Trivial change on main; one-line fix; the branch is already on a worktree; you need to commit and move on quickly.

## What a Worktree Is

A worktree is a separate working directory for the same git repo. Each has its own branch, but they share the `.git` directory. Cheap to create, instant to switch between.

```
~/code/myapp          ← main worktree, on `main`
~/code/myapp-feature  ← worktree, on `feature/auth`
```

Both share history. Both can be on different branches. Both are full working copies.

## Create a Worktree

```bash
# New branch + new worktree
git worktree add -b feature/auth ~/code/myapp-feature main

# Existing branch
git worktree add ~/code/myapp-feature feature/auth

# PR (just the work, not the branch)
git worktree add --detach ~/code/myapp-pr origin/pr/123
```

`add -b` creates a new branch. Without, the existing branch is checked out.

## Common Patterns

| Pattern | Command |
|---|---|
| Feature work, isolated | `git worktree add -b feature/X ../X main` |
| Switch back to main | `cd ../myapp && git checkout main` |
| Compare two branches | Two worktrees, diff between them |
| Review a PR | `git worktree add --detach ../pr-123 origin/pr/123` |
| Cleanup old | `git worktree remove ../X && git worktree prune` |

## Smart Directory Selection

```
~/code/myapp          ← existing
~/code/myapp-feature  ← new, sibling
```

Use a sibling directory, not nested. Avoids confusion with `pwd`.

```bash
# Inside myapp/, create sibling myapp-<branch>
git worktree add -b $BRANCH ../myapp-$BRANCH main
```

## Safety Checks

Before creating a worktree:
- **Is the branch already on a worktree?** `git worktree list` shows all.
- **Is the working copy dirty?** `git status` — commit or stash first.
- **Is the target directory empty?** Don't overwrite.
- **Is the path absolute?** `git worktree add` requires absolute paths in some configs.

## Red Flags

Worktree nested inside the repo (use a sibling directory — nested paths confuse `pwd`); same branch checked out in two worktrees (git refuses); dead worktrees never pruned; switching without committing (lost work is not in stash); pushing to the wrong branch (you have two now); "which directory am I in?" confusion (keep worktrees single-purpose — finish or prune); a worktree for a one-line fix (overhead); five worktrees accumulating (prune, focus).
