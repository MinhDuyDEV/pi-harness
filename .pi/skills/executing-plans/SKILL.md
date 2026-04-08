---
name: executing-plans
description: Use when a complete implementation plan exists — parses dependency waves, executes independent tasks in parallel via subagents, runs review checkpoints between waves
version: 2.0.0
tags: [workflow, planning, parallel]
dependencies: [writing-plans]
---

# Executing Plans

> **Replaces** sequential task-by-task implementation — detects parallelizable waves and dispatches subagents concurrently within each wave

## When to Use

- A complete implementation plan exists (`.beads/artifacts/<id>/plan.md` or provided directly)
- The plan has a dependency graph with wave assignments from `/plan`

## When NOT to Use

- No plan yet (use `writing-plans` or `prd` first)
- All tasks are tightly sequential with no parallelism opportunity
- Fewer than 3 tasks (just execute directly, overhead not worth it)

## Overview

Load plan → parse dependency waves → execute each wave (parallel within, sequential between) → review after each wave → next wave.

**Core principle:** Parallel within waves, sequential between waves, review at wave boundaries.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

## The Process

### Step 1: Load and Review Plan

#### Plan Review Checklist

- [ ] Read the plan file end-to-end
- [ ] Identify goal, deliverables, risks, and missing pieces
- [ ] If concerns, ask via `question()` and wait for decision
- [ ] If no concerns, proceed to wave parsing

1. Read plan file
2. Review critically — identify any questions or concerns
3. If concerns: raise them with `question()` tool
4. If no concerns: proceed

### Step 2: Parse Dependency Graph

Look for the dependency graph section in the plan. The `/plan` command generates this format:

```
## Dependency Graph

Task A: needs nothing, creates src/models/X.ts
Task B: needs Task A, creates src/api/X.ts
Task C: needs nothing, creates src/utils/Y.ts
Task D: needs Task B + Task C, creates src/routes/Z.ts

Wave 1: A, C  (independent)
Wave 2: B     (depends on A)
Wave 3: D     (depends on B, C)
```

**Extract:**
- Which tasks belong to each wave
- Which files each task modifies (for conflict detection)
- Dependencies between tasks

**If no dependency graph found:** Fall back to sequential execution (batch of 3 tasks).

**File conflict check:** Tasks in the same wave MUST NOT modify the same files. If they do, move one to the next wave.

### Step 3: Create TodoWrite

Create todos for all tasks, grouped by wave:

```typescript
todowrite({
  todos: [
    { content: "Wave 1: Task A — [description]", status: "pending", priority: "high" },
    { content: "Wave 1: Task C — [description]", status: "pending", priority: "high" },
    { content: "Wave 1 review checkpoint", status: "pending", priority: "high" },
    { content: "Wave 2: Task B — [description]", status: "pending", priority: "high" },
    { content: "Wave 2 review checkpoint", status: "pending", priority: "high" },
    // ...
  ]
});
```

### Step 4: Execute Wave

**Before starting a wave:** create a git tag for safe rollback:

```bash
git tag wave-${WAVE_NUMBER}-start
```

#### Single-task wave (no parallelism needed)

Execute directly in the current agent context. No subagent overhead.

#### Multi-task wave (2+ independent tasks)

Dispatch parallel subagents — one per task:

```typescript
// Dispatch all tasks in this wave simultaneously
task({
  subagent_type: "general",
  description: `Wave ${N}: Task A — ${taskTitle}`,
  prompt: `You are implementing Task A from the plan.

## Task
${taskDescription}

## Files to modify
${taskFiles.join('\n')}

## Constraints
- ONLY modify files listed above
- Follow each step exactly as written in the task
- Run verification commands specified in the task
- Commit your changes: git add <specific-files> && git commit -m "feat: ${taskTitle}"

## Report back
- What you implemented
- Files changed
- Verification results (pass/fail)
- Commit hash
- Any issues or blockers`
});
// ...dispatch other tasks in this wave simultaneously
```

**Critical rules for parallel dispatch:**

| Rule | Why |
| --- | --- |
| Non-overlapping files | Subagents editing same file = merge conflicts |
| Exact file list per subagent | Prevents scope creep into other tasks |
| Each subagent commits independently | Clean git history per task |
| Never `git add .` | Only stage files from this task |

#### Wave Execution Checklist

- [ ] Create wave start tag: `git tag wave-${WAVE_NUMBER}-start`
- [ ] Dispatch subagents for all tasks in this wave (parallel)
- [ ] Collect results from all subagents
- [ ] Check for failures — if any task failed, stop and report
- [ ] Run verification gates (typecheck + lint in parallel, then tests)
- [ ] Create wave complete tag: `git tag wave-${WAVE_NUMBER}-complete`
- [ ] Mark wave tasks as completed in TodoWrite

### Step 5: Review Wave

After each wave completes:

1. **Synthesize results** from all subagents
2. **Run verification gates** on the combined changes:
   ```bash
   # Parallel: typecheck + lint
   npm run typecheck & npm run lint & wait
   # Sequential: tests
   npm test
   ```
3. **Report to user:**
   - Tasks completed in this wave
   - Verification results
   - Wave tag created
   - Any issues found
4. **Wait for feedback** before proceeding to next wave

### Step 6: Next Wave

Based on feedback:
- Apply corrections if needed
- Execute next wave (repeat Steps 4-5)
- Continue until all waves complete

### Step 7: Complete Development

After all waves complete and verified:

- Announce: "I'm using finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use skill({ name: "finishing-a-development-branch" })
- Follow that skill to verify tests, present options, execute choice

## Wave-Level Rollback with Git Tags

Git tags act as checkpoints between waves. If a wave fails irrecoverably, roll back to the last known-good state.

### Tag Protocol

| When                         | Command                         | Purpose                   |
| ---------------------------- | ------------------------------- | ------------------------- |
| Before starting any wave     | `git tag wave-N-start`          | Mark rollback point       |
| After wave passes all gates  | `git tag wave-N-complete`       | Seal confirmed-good state |
| On irrecoverable failure     | `git reset --hard wave-N-start` | Restore to pre-wave state |
| Listing all wave checkpoints | `git tag --list "wave-*"`       | Audit trail of execution  |

### When to Rollback

Roll back (with user confirmation) when:
- Verification gates fail twice consecutively in the same wave
- Subagent made destructive changes outside its file scope
- Tests were broken and the cause is unclear

**Always ask the user before running `git reset --hard`** — it discards uncommitted changes irreversibly.

## Sequential Fallback

If the plan has no dependency graph or waves:

1. Group tasks into batches of 3
2. Execute each batch sequentially (no parallel subagents)
3. Review between batches
4. Same wave-tag protocol applies

This preserves backward compatibility with plans that don't have wave assignments.

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Subagent reports a blocker or failure
- File conflict detected between parallel tasks
- Verification fails twice in the same wave
- Plan has critical gaps preventing starting

**Ask for clarification rather than guessing.**

## Anti-Patterns

| Anti-Pattern | Why It Fails | Instead |
| --- | --- | --- |
| Dispatching parallel subagents for tasks that share files | Edit conflicts, lost changes, merge chaos | Move conflicting tasks to separate waves |
| Skipping verification between waves | Broken code compounds across waves | Run all gates after each wave before proceeding |
| Giving subagents the full plan instead of their task | Context pollution, scope creep | Extract only the specific task + file list |
| Running all tasks in one wave regardless of dependencies | Later tasks fail because prerequisites aren't ready | Respect the dependency graph strictly |
| Not committing per-task | Can't rollback individual tasks, messy git history | Each subagent commits its own changes |

## See Also

- `writing-plans` — Create detailed, zero-ambiguity implementation plans before execution
- `swarm-coordination` — For 10+ task scenarios with full PARL orchestration
- `subagent-driven-development` — For sequential per-task execution with review between each
- `verification-before-completion` — Run final verification gates before claiming completion
