---
name: requesting-code-review
description: Use when completing tasks, implementing major features, or before merging to verify work meets requirements - dispatches 5 parallel specialized review agents for comprehensive multi-angle review
version: 1.0.0
tags: [workflow, code-quality]
dependencies: []
---

# Requesting Code Review

## When to Use

- After completing a feature/task batch and before moving on
- Before merging to main or shipping changes

## When NOT to Use

- During TDD RED commits or other intentionally failing states
- When you only need a targeted answer to a specific question

## When to Request Review

**Mandatory:**

- After completing a feature / task batch before moving to next
- Before merge to main

**Not a review use case:**

- When stuck on an approach → ask one agent a specific question directly
- TDD RED commits (failing test commits are supposed to fail — don't review non-shippable state)

## How to Request

### Step 1: Get git context

#### Review Setup Checklist

- [ ] Determine BASE_SHA and HEAD_SHA
- [ ] Ensure requirements summary or plan link is available

```bash
BASE_SHA=$(git rev-parse origin/main 2>/dev/null || git rev-parse HEAD~1)
HEAD_SHA=$(git rev-parse HEAD)
```

### Step 2: Dispatch all 5 agents in parallel

No tiering. 5 agents always. They run simultaneously — wall-clock cost is the same as 1.

Perform all 5 review passes on the diff (`git diff {BASE_SHA}..{HEAD_SHA}`):

**Review 1 — Security + Correctness**
What was implemented: {WHAT_WAS_IMPLEMENTED}
Requirements: {PLAN_OR_REQUIREMENTS}
Check for:

- Security vulnerabilities (injection, auth bypass, secrets exposure, input validation)
- Logic errors, off-by-one, null/undefined access
- Missing error handling on async operations
- Data integrity issues
  Return: CRITICAL / IMPORTANT / MINOR findings with file:line references.

**Review 2 — Performance + Architecture**
What was implemented: {WHAT_WAS_IMPLEMENTED}
Check for:

- N+1 queries, unnecessary loops, missing indexes
- Over-engineering (abstraction not earned by use cases)
- Coupling that will make future changes painful
- Missing caching where obviously needed
- Bundle size regressions (if frontend)
  Return: CRITICAL / IMPORTANT / MINOR findings with file:line references.

**Review 3 — Type Safety + Test Coverage**
What was implemented: {WHAT_WAS_IMPLEMENTED}
Check for:

- Type safety holes (any casts, unsafe assertions, missing generics)
- Tests that only test mocks instead of real behavior
- Missing edge case tests (null, empty, boundary values)
- Tests that would pass even if the implementation was wrong
- Coverage gaps on critical paths
  Return: CRITICAL / IMPORTANT / MINOR findings with file:line references.

**Review 4 — Conventions + Patterns**
What was implemented: {WHAT_WAS_IMPLEMENTED}
Run `git log --oneline -10` for codebase context.
Check for:

- Inconsistent naming vs rest of codebase
- Patterns that diverge from established codebase patterns
- Missing or wrong use of shared utilities already in the codebase
- File organization that doesn't match project structure
- Documentation drift (code does X, docs say Y)
  Return: CRITICAL / IMPORTANT / MINOR findings with file:line references.

**Review 5 — Simplicity + Completeness**
What was implemented: {WHAT_WAS_IMPLEMENTED}
Requirements: {PLAN_OR_REQUIREMENTS}
Check for:

- Dead code (unreachable branches, unused variables, commented-out code)
- Requirements that were specified but not implemented
- Complexity that could be deleted without losing value
- TODOs left in production code paths
  Return: CRITICAL / IMPORTANT / MINOR findings with file:line references.

### Step 3: Synthesize findings

#### Synthesis Checklist

- [ ] Count Critical / Important / Minor findings
- [ ] List file:line references for each issue
- [ ] Mark readiness: proceed vs fix required

After all 5 agents return:

```markdown
## Review Summary

**Agents run:** 5
**Critical:** [N] — BLOCK, fix before proceeding
**Important:** [N] — Fix in this PR
**Minor:** [N] — Track as improvements

### Critical Issues

[List with file:line, description, suggested fix]

### Important Issues

[List with file:line, description]

### Assessment

[ ] Ready to proceed [ ] Fix required first
```

### Step 4: Act on findings

#### Remediation Checklist

- [ ] Fix all Critical issues before proceeding
- [ ] Fix Important issues in this PR
- [ ] Record Minor issues for later

| Severity      | Action                                   |
| ------------- | ---------------------------------------- |
| **Critical**  | Fix immediately before any other work    |
| **Important** | Fix in this PR before merge              |
| **Minor**     | Note in bead comments, fix later or skip |

Push back if reviewer is wrong — show code/tests that prove it works.

## Placeholders Reference

| Placeholder              | What to fill                            |
| ------------------------ | --------------------------------------- |
| `{WHAT_WAS_IMPLEMENTED}` | Brief description of the feature/fix    |
| `{PLAN_OR_REQUIREMENTS}` | Link to plan.md or requirements summary |
| `{BASE_SHA}`             | Starting commit SHA                     |
| `{HEAD_SHA}`             | Ending commit SHA                       |

## Integration with Workflows

| Command | When review runs                      |
| ------- | ------------------------------------- |
| `/ship` | After all tasks complete + gates pass |
| `/pr`   | Mandatory gate before push to GitHub  |
| `/lfg`  | Between work and compound steps       |

All Critical issues must be resolved before proceeding. No exceptions.

## After Review: Compound

Run `/compound` after fixing review findings to capture:

- What the review caught (patterns to watch for)
- What false positives were dismissed (and why)
- Any codebase conventions discovered during review

This is how the review step feeds the compound flywheel.
