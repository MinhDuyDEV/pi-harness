---
name: sprint-qa
description: Use during sprint QA phase to formally validate code with test coverage audit, edge case hunting, regression test generation, and multi-mode testing.
version: 1.0.0
tags: [workflow, sprint, testing, quality]
dependencies: [test-driven-development]
---

# Sprint QA

## When to Use
- Sprint Review phase is complete — code reviewed and critical issues fixed
- You need formal QA validation before shipping
- Want to catch edge cases and generate regression tests for every fix

## When NOT to Use
- Tests are already comprehensive and you're confident (skip with `/sprint skip qa`)
- Pure documentation or config changes with no behavioral impact
- You're resuming a sprint that already completed QA phase

## Overview

QA is a formal testing phase, separate from TDD during Build. Where TDD ensures each unit works, QA validates the whole feature end-to-end and hunts for what was missed.

**Input**: Code changes + review-log.jsonl + plan.md
**Output**: `.beads/sprints/<sprint-id>/qa-report.md`

## Testing Modes

Choose based on context:

| Mode | When | Duration | Coverage |
|------|------|----------|----------|
| **Diff-aware** (default) | Normal sprint | 2-5 min | Changed code + blast radius |
| **Full** | Major feature, release prep | 5-15 min | Entire test suite + manual |
| **Quick** | Minor changes, time-pressed | 30 sec | Changed files only |

```
question({
  questions: [{
    header: "QA Mode",
    question: "Select QA depth:",
    options: [
      { label: "Diff-aware (recommended)", description: "Test changed code + what depends on it" },
      { label: "Full", description: "Complete test suite + edge case hunting" },
      { label: "Quick", description: "Changed files only, fast pass" }
    ]
  }]
})
```

## The Process

### Step 1: Test Coverage Audit

Run existing tests and measure coverage:

Detect test runner from project config (package.json `scripts.test`, Makefile, pyproject.toml, Cargo.toml, go.mod). Adapt commands accordingly. Examples:
```bash
npm test -- --coverage 2>&1 || true
pytest --cov --cov-report=term-missing 2>&1 || true
go test -cover ./... 2>&1 || true
```

Map coverage against changed files:
- **Covered**: Changed lines hit by existing tests ✅
- **Uncovered**: Changed lines with no test coverage ⚠️
- **Critical uncovered**: Changed lines in error paths, edge cases, security code 🚨

Report:
```
Coverage: 47/52 changed lines covered (90%)
Uncovered:
  src/auth.ts:88-92    — error handling path (CRITICAL)
  src/auth.ts:134      — edge case: empty input
```

### Step 2: Edge Case Hunting

For each changed function/module, systematically test:

**Input boundaries**:
- Empty/null/undefined inputs
- Maximum-length inputs
- Unicode, special characters, injection attempts
- Concurrent/parallel invocations

**State boundaries**:
- First use (empty state)
- After error recovery
- During migration/upgrade
- With stale cache/data

**Integration boundaries**:
- Network timeout/failure
- Disk full/permission denied
- Dependency returns unexpected format
- Rate limiting / throttling

For each edge case found, write a test BEFORE fixing:
```
skill({ name: "test-driven-development" })
```

### Step 3: Regression Test Generation

For every issue found during Review phase (from `review-log.jsonl`):

1. Read the review finding
2. Write a test that would have caught it
3. Verify the test passes with current code
4. Commit: `test: regression test for <issue description>`

This ensures the same bug class never recurs.

### Step 4: Test Quality Check

Review existing tests for:
- **False positives**: Tests that pass when they shouldn't (test the assertion, not just "no error")
- **Flaky tests**: Tests that sometimes fail (timing, external dependencies)
- **Missing assertions**: Tests that run code but don't verify behavior
- **Test isolation**: Tests that depend on execution order or shared state

### Step 5: Run Full Suite

```bash
# Run everything
npm test 2>&1
# Or
pytest -v 2>&1
```

If failures:
1. Classify: **in-branch** (we broke it) vs **pre-existing** (already broken on main)
2. In-branch failures: fix immediately, re-run
3. Pre-existing failures: log in QA report, don't block sprint

### Step 6: Write QA Report

Save to `.beads/sprints/<sprint-id>/qa-report.md`:
```markdown
# QA Report: <sprint title>

## Summary
- Mode: Diff-aware
- Tests run: 142
- Tests passed: 140
- Tests added: 8
- Coverage delta: +3.2% (87% → 90.2%)

## Edge Cases Found
| # | Description | Test Added | Severity |
|---|------------|-----------|----------|

## Regression Tests
| # | Review Finding | Test File | Status |
|---|---------------|-----------|--------|

## Pre-existing Failures
| Test | Since | Ticket |
|------|-------|--------|

## Verdict
✅ PASS — All in-branch tests passing, coverage above threshold.
```

### Step 7: Gate — QA Passed

```
question({
  questions: [{
    header: "QA Gate",
    question: "QA complete. <N> tests added, <M>% coverage. Verdict: <PASS/FAIL>",
    options: [
      { label: "Approve — move to Ship", description: "QA is satisfactory" },
      { label: "Add more tests", description: "Coverage or edge cases need work" },
      { label: "Back to Build", description: "Found issues that need implementation changes" }
    ]
  }]
})
```

On approval: update sprint state, set `gates.qa-passed = true`.

## After QA
QA passed → Load `/skill:sprint-ship` for shipping.
