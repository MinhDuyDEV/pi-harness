---
name: subagent-driven-development
description: Use when executing implementation plans with independent tasks in the current session - dispatches fresh subagent for each task with code review between tasks, enabling fast iteration with quality gates
version: 1.0.0
tags: [workflow, agent-coordination]
dependencies: [executing-plans]
---

# Subagent-Driven Development

> **Replaces** monolithic single-agent implementation sessions that grow stale — dispatches fresh subagents per task with code review gates between them

## When to Use

- Executing a plan with mostly independent tasks in the same session
- You want a fresh subagent per task plus review checkpoints

## When NOT to Use

- The plan requires review or revisions first (use executing-plans)
- Tasks are tightly coupled and need manual sequencing

## Overview

**vs. Executing Plans (parallel session):**

- Same session (no context switch)
- Fresh subagent per task (no context pollution)
- Code review after each task (catch issues early)
- Faster iteration (no human-in-loop between tasks)

## The Process

### 1. Load Plan

Read plan file, create TodoWrite with all tasks.

**Context file pattern:** If the plan exceeds ~500 tokens, write it to `.beads/artifacts/<id>/plan-context.md` and reference by path in subagent prompts instead of inlining. This saves tokens when dispatching multiple subagents from the same plan.

### 2. Execute Task with Subagent

For each task:

**Dispatch fresh subagent:**

```
Task tool (general-purpose):
  description: "Implement Task N: [task name]"
  prompt: |
    You are implementing Task N from [plan-file].

    Read that task carefully. Your job is to:
    1. Implement exactly what the task specifies
    2. Write tests (following TDD if task says to)
    3. Verify implementation works
    4. Commit your work
    5. Report back

    Work from: [directory]

    [Include Structured Termination Contract from AGENTS.md]
```

**After subagent reports back** — follow the **Worker Distrust Protocol** from AGENTS.md:

1. Read changed files directly (don't trust the report)
2. Run verification on modified files (typecheck + lint minimum)
3. Check acceptance criteria against original task spec
4. Only then mark the task as complete

### 3. Review Subagent's Work

**Dispatch review subagent:**

Use template at requesting-code-review/review.md

WHAT_WAS_IMPLEMENTED: [from subagent's report]
PLAN_OR_REQUIREMENTS: Task N from [plan-file]
BASE_SHA: [commit before task]
HEAD_SHA: [current commit]
DESCRIPTION: [task summary]

```

**Code reviewer returns:** Strengths, Issues (Critical/Important/Minor), Assessment

### 4. Apply Review Feedback

**If issues found:**

- Fix Critical issues immediately
- Fix Important issues before next task
- Note Minor issues

**Dispatch follow-up subagent if needed:**

```

"Fix issues from code review: [list issues]"

```

### 5. Mark Complete, Next Task

- Mark task as completed in TodoWrite
- Move to next task
- Repeat steps 2-5

### 6. Final Review

After all tasks complete, dispatch final review:

- Reviews entire implementation
- Checks all plan requirements met
- Validates overall architecture

### 7. Complete Development

After final review passes:

- Announce: "I'm using finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use skill({ name: "finishing-a-development-branch" })
- Follow that skill to verify tests, present options, execute choice

## Example Workflow

```

You: I'm using Subagent-Driven Development to execute this plan.

[Load plan, create TodoWrite]

Task 1: Hook installation script

[Dispatch implementation subagent]
Subagent: Implemented install-hook with tests, 5/5 passing

[Get git SHAs, dispatch review]
Reviewer: Strengths: Good test coverage. Issues: None. Ready.

[Mark Task 1 complete]

Task 2: Recovery modes

[Dispatch implementation subagent]
Subagent: Added verify/repair, 8/8 tests passing

[Dispatch review]
Reviewer: Strengths: Solid. Issues (Important): Missing progress reporting

[Dispatch fix subagent]
Fix subagent: Added progress every 100 conversations

[Verify fix, mark Task 2 complete]

...

[After all tasks]
[Dispatch final review]
Final reviewer: All requirements met, ready to merge

Done!

```

## Advantages

**vs. Manual execution:**

- Subagents follow TDD naturally
- Fresh context per task (no confusion)
- Parallel-safe (subagents don't interfere)

**vs. Executing Plans:**

- Same session (no handoff)
- Continuous progress (no waiting)
- Review checkpoints automatic

**Cost:**

- More subagent invocations
- But catches issues early (cheaper than debugging later)

## Red Flags

**Never:**

- Skip code review between tasks
- Proceed with unfixed Critical issues
- Dispatch multiple implementation subagents in parallel (conflicts)
- Implement without reading plan task

**If subagent fails task:**

- Dispatch fix subagent with specific instructions
- Don't try to fix manually (context pollution)

## Anti-Patterns

| Anti-Pattern | Why It Fails | Instead |
| --- | --- | --- |
| Dispatching subagents for tasks with shared state/files | Creates edit conflicts, race conditions, and unclear ownership | Keep shared-state work sequential under one subagent at a time |
| Skipping code review between subagent tasks | Lets defects accumulate and compounds later fixes | Run a review gate after each task before moving on |
| Giving subagents vague prompts without file paths or acceptance criteria | Produces off-target changes and repeated back-and-forth | Provide exact file paths, task scope, and acceptance criteria |
| Not verifying subagent output before moving to next task | Carries regressions forward into later tasks | Validate output immediately before starting the next task |

## Verification

- After each subagent completes: review its changes, run typecheck + lint on modified files
- After all tasks: run full test suite to catch integration issues
- Check: no conflicting edits between subagent outputs

## Integration

**Required workflow skills:**

- **writing-plans** - REQUIRED: Creates the plan that this skill executes
- **requesting-code-review** - REQUIRED: Review after each task (see Step 3)
- **finishing-a-development-branch** - REQUIRED: Complete development after all tasks (see Step 7)

**Subagents must use:**

- **test-driven-development** - Subagents follow TDD for each task

**Alternative workflow:**

- **executing-plans** - Use for parallel session instead of same-session execution

See review template: requesting-code-review/review.md
```

## See Also

- **dispatching-parallel-agents** — for parallel investigation
- **executing-plans** — for batch execution with checkpoints
- **requesting-code-review** — for review between subagent tasks
