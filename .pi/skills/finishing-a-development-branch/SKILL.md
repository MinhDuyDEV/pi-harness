---
name: finishing-a-development-branch
description: Use when implementation is complete, all tests pass, and you need to decide how to integrate the work - guides completion of development work by presenting structured options for merge, PR, or cleanup
version: 1.0.0
tags: [workflow, git]
dependencies: []
---

# Finishing a Development Branch

## When to Use

- Implementation is complete and tests pass, and you need to merge/PR/cleanup
- You must present structured end-of-work options and execute the chosen path

## When NOT to Use

- Tests or mandatory gates are failing
- Work is still in progress and not ready for integration

## Overview

Guide completion of development work by presenting clear options and handling chosen workflow.

**Core principle:** Verify tests → Present options → Execute choice → Clean up.

**Announce at start:** "I'm using the finishing-a-development-branch skill to complete this work."

## The Process

### Step 1: Verify Tests

#### Completion Prep Checklist

- [ ] Run the project's test suite
- [ ] Stop if any tests fail and report failures

**Before presenting options, verify tests pass:**

```bash
# Run project's test suite
npm test / cargo test / pytest / go test ./...
```

**If tests fail:**

```
Tests failing (<N> failures). Must fix before completing:

[Show failures]

Cannot proceed with merge/PR until tests pass.
```

Stop. Don't proceed to Step 2.

**If tests pass:** Continue to Step 2.

### Step 2: Determine Base Branch

```bash
# Try common base branches
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
```

Or ask: "This branch split from main - is that correct?"

### Step 3: Present Options

Use question tool to present completion options:

```typescript
question({
  questions: [
    {
      header: "Complete",
      question: "Implementation complete. What would you like to do?",
      options: [
        {
          label: "Merge locally (Recommended)",
          description: "Merge to base branch",
        },
        {
          label: "Push & create PR",
          description: "Create pull request for review",
        },
        { label: "Keep branch", description: "I'll handle it later" },
        { label: "Discard work", description: "Delete this branch" },
      ],
    },
  ],
});
```

**Don't add explanation** - keep options concise.

### Step 4: Execute Choice

#### Execute Choice Checklist

- [ ] Follow the selected option's steps exactly
- [ ] Re-run tests on merged result when applicable
- [ ] Only cleanup worktree for Options 1, 2, or 4

#### Option 1: Merge Locally

```bash
# Switch to base branch
git checkout <base-branch>

# Pull latest
git pull

# Merge feature branch
git merge <feature-branch>

# Verify tests on merged result
<test command>

# If tests pass
git branch -d <feature-branch>
```

Then: Cleanup worktree (Step 5)

#### Option 2: Push and Create PR

```bash
# Push branch
git push -u origin <feature-branch>

# Create PR
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
<2-3 bullets of what changed>

## Test Plan
- [ ] <verification steps>
EOF
)"
```

Then: Cleanup worktree (Step 5)

#### Option 3: Keep As-Is

Report: "Keeping branch <name>. Worktree preserved at <path>."

**Don't cleanup worktree.**

#### Option 4: Discard

**Confirm first:**

```
This will permanently delete:
- Branch <name>
- All commits: <commit-list>
- Worktree at <path>

Type 'discard' to confirm.
```

Wait for exact confirmation.

If confirmed:

```bash
git checkout <base-branch>
git branch -D <feature-branch>
```

Then: Cleanup worktree (Step 5)

### Step 5: Cleanup Worktree

**For Options 1, 2, 4:**

Check if in worktree:

```bash
git worktree list | grep $(git branch --show-current)
```

If yes:

```bash
git worktree remove <worktree-path>
```

**For Option 3:** Keep worktree.

## Quick Reference

| Option           | Merge | Push | Keep Worktree | Cleanup Branch |
| ---------------- | ----- | ---- | ------------- | -------------- |
| 1. Merge locally | ✓     | -    | -             | ✓              |
| 2. Create PR     | -     | ✓    | ✓             | -              |
| 3. Keep as-is    | -     | -    | ✓             | -              |
| 4. Discard       | -     | -    | -             | ✓ (force)      |

## Mandatory Build Gates (Longshot Pattern)

**Build gates are non-optional before any merge/PR/close.** Advisory verification has failed at scale — gates must be enforced as hard blockers.

### Gate Sequence

#### Gate Checklist

- [ ] Gate 1: `npm run typecheck`
- [ ] Gate 2: `npm run lint` (run `npm run lint:fix` if needed)
- [ ] Gate 3: `vitest`
- [ ] Stop and fix if any gate fails

Every bead MUST pass all three gates in order. No exceptions.

```bash
# Gate 1: Typecheck
npm run typecheck
# Must exit 0. If fails → STOP. Fix types first.

# Gate 2: Lint
npm run lint
# Must exit 0. If fails → STOP. Run npm run lint:fix, then fix remaining.

# Gate 3: Tests
vitest
# Must exit 0. If fails → STOP. Fix failing tests first.
```

### Gate Enforcement Script

Run before every merge, PR creation, or bead close:

```bash
#!/bin/bash
# Run mandatory gates — all must pass

echo "Gate 1/3: Typecheck..."
npm run typecheck || { echo "FAILED: Fix type errors before proceeding."; exit 1; }

echo "Gate 2/3: Lint..."
npm run lint || {
  echo "Attempting auto-fix..."
  npm run lint:fix
  npm run lint || { echo "FAILED: Fix lint errors before proceeding."; exit 1; }
}

echo "Gate 3/3: Tests..."
vitest || { echo "FAILED: Fix failing tests before proceeding."; exit 1; }

echo "All gates passed. Safe to merge/PR/close."
```

### Gate Failure Response

| Gate Failure | First Action                     | If Still Failing            |
| ------------ | -------------------------------- | --------------------------- |
| Typecheck    | Fix type errors at reported line | Use LSP hover for type info |
| Lint         | Run `npm run lint:fix`           | Fix remaining manually      |
| Tests        | Read failing test output         | Fix implementation or test  |

### Hard Rules

**NEVER:**

- Close a bead without passing all 3 gates
- Create a PR without passing all 3 gates
- Merge locally without passing all 3 gates on merged result
- Skip gates "because the change is small"

**ALWAYS:**

- Run gates after EVERY non-trivial file change
- Re-run gates after fixing gate failures (to catch regressions)
- Run gates on the merged result, not just the branch

### Integration with Bead Workflow

```bash
# Before closing any bead:
npm run typecheck && npm run lint && vitest

# If all pass:
br close <id> --reason "Implementation complete. All gates passed."
br sync --flush-only

# If any fail:
# STOP. Fix. Re-run gates. Then close.
```

### Gate State in Delegation Packets

Workers must include gate results in their completion report:

```markdown
## Completion Report

### Gate Results

- [ ] typecheck: PASS / FAIL (error: ...)
- [ ] lint: PASS / FAIL (error: ...)
- [ ] tests: PASS / FAIL (N failed, N passed)

### Gate Command Used

`npm run typecheck && npm run lint && vitest`
```

## Common Mistakes

**Skipping test verification**

- **Problem:** Merge broken code, create failing PR
- **Fix:** Always verify tests before offering options

**Open-ended questions**

- **Problem:** "What should I do next?" → ambiguous
- **Fix:** Present exactly 4 structured options

**Automatic worktree cleanup**

- **Problem:** Remove worktree when might need it (Option 2, 3)
- **Fix:** Only cleanup for Options 1 and 4

**No confirmation for discard**

- **Problem:** Accidentally delete work
- **Fix:** Require typed "discard" confirmation

## Red Flags

**Never:**

- Proceed with failing tests
- Merge without verifying tests on result
- Delete work without confirmation
- Force-push without explicit request

**Always:**

- Verify tests before offering options
- Present exactly 4 options
- Get typed confirmation for Option 4
- Clean up worktree for Options 1 & 4 only

## Integration

**Called by:**

- **subagent-driven-development** (Step 7) - After all tasks complete
- **executing-plans** (Step 5) - After all batches complete

**Pairs with:**

- **using-git-worktrees** - Cleans up worktree created by that skill
