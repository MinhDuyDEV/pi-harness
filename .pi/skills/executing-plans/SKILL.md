---
name: executing-plans
description: Use when partner provides a complete implementation plan to execute in controlled batches with review checkpoints - loads plan, reviews critically, executes tasks in batches, reports for review between batches
version: 1.0.0
tags: [workflow, planning]
dependencies: [writing-plans]
---

# Executing Plans

## When to Use

- A complete implementation plan exists and you need to execute it in batches with checkpoints
- You must follow a plan precisely and report between waves for feedback

## When NOT to Use

- There is no plan yet or requirements are still unclear
- You need to create the plan or tasks first (use writing-plans or prd)

## Overview

Load plan, review critically, execute tasks in batches, report for review between batches.

**Core principle:** Batch execution with checkpoints for architect review.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

## The Process

### Step 1: Load and Review Plan

#### Plan Review Checklist

- [ ] Read the plan file end-to-end
- [ ] Identify goal, deliverables, risks, and missing pieces
- [ ] If concerns, ask the user and wait for decision
- [ ] If no concerns, track all tasks and proceed

1. Read plan file
2. Review critically - identify any questions or concerns about the plan
3. If concerns: Ask the user:

   "Plan review complete. Any concerns before proceeding?
   - No concerns (Recommended) — Plan looks good, execute batches
   - Has concerns — Need clarification before starting"

4. Read plan and identify:
   - What is the goal?
   - What are the deliverables?
   - What are the risks?
   - Does the approach make sense?
   - Are there missing pieces?

If no concerns: Track all tasks and proceed
If concerns: Wait for human to decide and resubmit

### Step 2: Execute Batch

**Default: First 3 tasks**

**Before starting a batch**: create a wave-start git tag for safe rollback:

```bash
# Tag the safe point before this batch/wave
git tag wave-${BATCH_NUMBER}-start
```

#### Batch Execution Checklist

- [ ] Create wave start tag: `git tag wave-${BATCH_NUMBER}-start`
- [ ] Mark each task in_progress
- [ ] Follow each step exactly as written
- [ ] Run all specified verifications
- [ ] Mark tasks completed
- [ ] Create wave complete tag: `git tag wave-${BATCH_NUMBER}-complete`

For each task:

1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. Run verifications as specified
4. Mark as completed

**After batch passes all gates**: create a wave-complete tag:

```bash
# Seal the completed wave - confirms all gates passed
git tag wave-${BATCH_NUMBER}-complete
```

### Step 3: Report

#### Batch Report Checklist

- [ ] Summarize what was implemented
- [ ] Include verification output
- [ ] Confirm wave tag created (e.g., `wave-1-complete`)
- [ ] Ask for feedback before continuing

When batch complete:

- Show what was implemented
- Show verification output
- Show wave tag created (e.g., `wave-1-complete`)
- Say: "Ready for feedback."

### Step 4: Continue

Based on feedback:

- Apply changes if needed
- Execute next batch
- Repeat until complete

### Step 5: Complete Development

After all tasks complete and verified:

- Announce: "I'm using finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use /skill:finishing-a-development-branch
- Follow that skill to verify tests, present options, execute choice

## Wave-Level Rollback with Git Tags

Git tags act as checkpoints between waves. If a wave fails irrecoverably, roll back to the last known-good state.

### Tag Protocol

| When                         | Command                         | Purpose                   |
| ---------------------------- | ------------------------------- | ------------------------- |
| Before starting any batch    | `git tag wave-N-start`          | Mark rollback point       |
| After batch passes all gates | `git tag wave-N-complete`       | Seal confirmed-good state |
| On irrecoverable failure     | `git reset --hard wave-N-start` | Restore to pre-wave state |
| Listing all wave checkpoints | `git tag --list "wave-*"`       | Audit trail of execution  |

### When to Rollback

Roll back (with user confirmation) when:

- Build gates fail twice consecutively in the same wave
- Unexpected destructive changes were made
- Drift check detects unrecoverable scope creep
- Tests were broken and the cause is unclear

**Always ask the user before running `git reset --hard`** - it discards uncommitted changes irreversibly.

### Rollback Steps

```bash
# 1. Identify safe point
git tag --list "wave-*"
# e.g.: wave-1-complete  wave-2-start  wave-2-complete  wave-3-start

# 2. Confirm with user: rollback to which tag?
# e.g.: git reset --hard wave-2-complete (last known good)

# 3. Execute rollback (ONLY after user confirms)
git reset --hard wave-2-complete

# 4. Verify state is clean
npm run typecheck && npm run lint

# 5. Re-plan the failed batch with new approach
```

### Tag Naming Convention

```
wave-1-start      # Before batch 1 starts
wave-1-complete   # After batch 1 passes all gates
wave-2-start      # Before batch 2 starts
wave-2-complete   # After batch 2 passes all gates
...
```

Use numeric batch numbers, not task names, for predictable reference.

## When to Stop and Ask for Help

**STOP executing immediately when:**

- Hit a blocker mid-batch (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**

- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember

- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Between batches: just report and wait
- Stop when blocked, don't guess
