---
name: sprint-review
description: Use during sprint Review phase to check code against the plan with scope drift detection, plan compliance audit, and 2-pass review.
version: 1.0.0
tags: [workflow, sprint, review, quality]
dependencies: [requesting-code-review]
---

# Sprint Review

## When to Use
- Sprint Build phase is complete — code is written, ready for review
- You need to verify implementation matches the plan (not just "code looks ok")
- Before QA phase to catch issues early

## When NOT to Use
- No plan exists (this review checks against the plan)
- Pure refactoring with no functional changes (use requesting-code-review directly)
- You're resuming a sprint that already completed Review phase

## Overview

Sprint Review goes beyond code quality — it checks whether what was built matches what was planned. Two key additions over standard code review: **scope drift detection** and **plan compliance audit**.

**Input**: Code changes (git diff) + `.beads/sprints/<sprint-id>/plan.md`
**Output**: `.beads/sprints/<sprint-id>/review-log.jsonl`

## The Process

### Step 0: Gather Context

```
Read: .beads/sprints/<sprint-id>/state.json → extract baseBranch (default: "main") as BASE_REF
Read: .beads/sprints/<sprint-id>/plan.md
```

```bash
# Get the diff against base branch
git diff $BASE_REF...HEAD --stat
git diff $BASE_REF...HEAD

# Get commit history
git log $BASE_REF..HEAD --oneline
```

### Step 1: Scope Drift Detection

Compare the diff against the plan's task list:

**Added scope** (in diff but not in plan):
- New files not mentioned in any task
- New features not in the design doc
- Dependencies added that weren't planned

**Missing scope** (in plan but not in diff):
- Tasks marked as part of the plan but not implemented
- Test cases specified but not written
- Edge cases identified in risk registry but not handled

**Drifted scope** (implemented differently than planned):
- Architecture deviations from the design
- API surface changes from what was designed
- Different patterns used than specified

Present drift findings to user:
```
Scope Drift Report:
  Added:   3 items (2 acceptable, 1 needs justification)
  Missing: 1 item (task 7 — deferred or forgotten?)
  Drifted: 2 items (different pattern used in auth module)
```

User must acknowledge each drift item: Accept (with reason) or Fix.

### Step 2: Plan Compliance Audit

For each task in the plan, verify:

- [ ] Task implemented as described
- [ ] Acceptance criteria met (run verification commands from plan)
- [ ] TDD steps followed (test exists before implementation)
- [ ] Files affected match plan's estimate

Score: `N/M tasks compliant` — report non-compliant tasks with specific gaps.

### Step 3: Code Review — Pass 1 (Critical)

Load requesting-code-review for specialized agents:
```
skill({ name: "requesting-code-review" })
```

Focus ONLY on critical issues:
- **Security**: Injection, auth bypass, data exposure, secrets in code
- **Correctness**: Logic errors, off-by-one, null handling, race conditions
- **Data loss**: Destructive operations without confirmation, missing backups
- **Breaking changes**: Public API changes, schema migrations without rollback

Each finding is a JSONL entry in review-log:
```json
{"pass": 1, "severity": "critical", "file": "path", "line": 42, "issue": "description", "fix": "suggestion", "status": "open"}
```

### Step 4: Fix Critical Issues

For each critical finding:
- **Mechanical fix** (clear solution): Auto-fix, commit, mark as `resolved`
- **Ambiguous fix** (multiple approaches): Ask user which approach, then fix
- **Design issue** (needs plan change): Flag for user decision — may require backtracking

**Hard gate**: ALL critical issues must be resolved before proceeding.

### Step 5: Code Review — Pass 2 (Informational)

Lower-severity review:
- **Performance**: Unnecessary allocations, N+1 queries, missing indexes
- **Style**: Naming conventions, code organization, comment quality
- **Maintainability**: DRY violations, complex conditionals, missing abstractions
- **Test quality**: Assertion coverage, edge cases, test isolation

Log as JSONL with `"pass": 2`. These are advisory — user decides which to address.

### Step 6: Enum & Value Completeness

Read code OUTSIDE the diff to check:
- New enum values handled in ALL switch/match statements
- New error types caught in ALL error handlers
- New config options documented in ALL relevant places
- New API endpoints added to ALL relevant middleware chains

This is where most bugs hide — in the code that DIDN'T change but SHOULD have.

### Step 7: Gate — Review Passed

```
question({
  questions: [{
    header: "Review Gate",
    question: "Review complete. Critical: <N> fixed. Informational: <M> noted. Proceed?",
    options: [
      { label: "Approve — move to QA", description: "All critical issues resolved" },
      { label: "Address more findings", description: "Fix some informational issues first" },
      { label: "Back to Build", description: "Need more implementation work" }
    ]
  }]
})
```

On approval: update sprint state, set `gates.review-passed = true`.

## Review Log Format

Each entry in `review-log.jsonl`:
```json
{
  "timestamp": "ISO-8601",
  "pass": 1,
  "severity": "critical|important|minor|info",
  "category": "security|correctness|performance|style|scope-drift|compliance",
  "file": "path/to/file.ts",
  "line": 42,
  "issue": "Description of the issue",
  "fix": "Suggested fix or null",
  "status": "open|resolved|acknowledged|deferred"
}
```

## After Review
Review passed → Load `/skill:sprint-qa` for QA phase.
