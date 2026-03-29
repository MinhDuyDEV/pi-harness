---
name: sprint-ship
description: Use during sprint Ship phase to run automated pre-flight checks, plan completion audit, changelog generation, and PR creation.
version: 1.0.0
tags: [workflow, sprint, shipping, deployment]
dependencies: [finishing-a-development-branch]
---

# Sprint Ship

## When to Use
- Sprint Review and QA phases are complete with gates passed
- Code is ready to merge/ship
- You want automated pre-flight verification before landing

## When NOT to Use
- Review or QA gates haven't passed (go back and complete them)
- You want to deploy without merge (use deployment skills directly)
- Hotfix that needs to skip the sprint process

## Overview

Ship is the automated landing pipeline. It verifies everything is green, audits plan completion, generates a changelog, and creates a clean PR. The goal: **ship should be boring** — all the hard decisions happened in earlier phases.

**Input**: All sprint artifacts + code on branch
**Output**: `.beads/sprints/<sprint-id>/changelog.md` + merged PR

## The Process

### Step 1: Pre-flight Checks

Verify ALL gates are green before proceeding:
```
Read: .beads/sprints/<sprint-id>/state.json

Required gates:
  ✅ think-approved  (or skipped with reason)
  ✅ plan-approved   (or skipped with reason)
  ✅ review-passed   (REQUIRED — cannot skip)
  ✅ qa-passed       (REQUIRED — cannot skip)
```

If any required gate is missing: **STOP**. Report which gate failed and how to resolve.

### Step 2: Review Log Check

Read `review-log.jsonl`. If any entries have `status: "open"` and `severity: "critical"`: **STOP**. Report the unresolved critical findings and require resolution before shipping.

### Step 3: Plan Completion Audit

Read the plan and check every task:

```
Read: .beads/sprints/<sprint-id>/plan.md
```

For each planned task:
- [ ] Implemented (code exists)
- [ ] Tested (test exists and passes)
- [ ] Acceptance criteria met (verification command passes)

Report:
```
Plan Completion: 12/14 tasks complete (86%)
  Missing:
    Task 9: "Add rate limiting" — deferred (user decision at Plan gate)
    Task 13: "Update API docs" — NOT DONE ⚠️
```

If tasks are incomplete:
- **Deferred tasks** (explicitly marked during Plan): Acceptable, log reason
- **Forgotten tasks**: Ask user — implement now or defer with justification

### Step 4: Adversarial Review

One final skeptical pass. Read the entire diff with a hostile mindset:

> "I am trying to find the one thing that will break in production at 3am."

Check specifically:
- **Error handling completeness**: Every external call has error handling
- **Resource cleanup**: Files closed, connections released, locks freed
- **Concurrency**: Shared state properly synchronized
- **Configuration**: No hardcoded values that should be configurable
- **Secrets**: No credentials, tokens, or keys in the diff
- **Backwards compatibility**: Existing callers still work

If anything is found: fix it. This is the last line of defense.

### Step 5: Commit Hygiene

Ensure commits are clean and bisectable:

```
Read: .beads/sprints/<sprint-id>/state.json → extract baseBranch (default: "main") as BASE_REF
```

```bash
# Check commit messages follow convention
git log $BASE_REF..HEAD --oneline

# Each commit should:
# - Do one thing
# - Have a descriptive message (feat:, fix:, test:, docs:, refactor:)
# - Pass tests independently
```

If commits are messy, offer to squash or reword:
```
question({
  questions: [{
    header: "Commits",
    question: "Commit history has <N> commits. Clean up?",
    options: [
      { label: "Keep as-is", description: "Commits are already clean" },
      { label: "Squash to 1", description: "Single commit with summary message" },
      { label: "Interactive rebase", description: "Clean up and reword selectively" }
    ]
  }]
})
```

### Step 6: Generate Changelog

Create `.beads/sprints/<sprint-id>/changelog.md`:

```markdown
# Changelog: <sprint title>

## Summary
<One paragraph describing what this sprint accomplished>

## Changes
### Added
- <New feature or capability>

### Changed
- <Modified behavior>

### Fixed
- <Bug fix>

## Files Changed
<N> files changed, <insertions> insertions(+), <deletions> deletions(-)

## Sprint Metrics
- Phases completed: <list>
- Total tasks: <N>
- Review findings fixed: <M>
- Tests added: <K>
```

### Step 7: Create PR or Merge

Load finishing-a-development-branch for the merge workflow:
```
skill({ name: "finishing-a-development-branch" })
```

Present options:
1. **Create PR** — push branch, create PR with changelog as description
2. **Merge directly** — merge to main (if repo policy allows)
3. **Keep branch** — don't merge yet (e.g., waiting for deployment window)

### Step 8: Update Sprint State

```json
{
  "phases": {
    "ship": { "status": "completed", "artifacts": ["changelog.md"], "completedAt": "..." }
  },
  "currentPhase": "reflect"
}
```

Report: "Shipped! Run `/sprint retro` to reflect on the sprint."

## After Ship
Shipped → Load `/skill:sprint-retro` for retrospective.
