---
name: incremental-implementation
description: Use when implementing features or fixes to enforce thin vertical slices with verify-after-each — prevents large, untested changes by requiring working code at every step
version: 1.0.0
tags: [workflow, implementation, code-quality]
dependencies: [test-driven-development, verification-before-completion]
---

# Incremental Implementation

> **Replaces** big-bang implementations where everything is built at once and tested at the end — enforces thin vertical slices with verification after each step

## When to Use

- Implementing any feature that touches more than 2 files
- Working from a plan or spec with multiple tasks
- Building something where partial progress should be demonstrable

## When NOT to Use

- One-line fixes or trivial changes
- Pure refactors with no behavior change (use code-simplification instead)
- Exploratory prototyping where you need to experiment freely

## Common Rationalizations

| Rationalization                                   | Rebuttal                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| "I'll build everything first and test at the end" | End-to-end testing after 500 lines of changes makes failures impossible to isolate                                  |
| "This feature can't be split into slices"         | Every feature can be sliced — you're confusing "the UI needs all parts" with "the code must be written all at once" |
| "Committing partial work creates noise"           | Partial working commits are rollback points. One giant commit is a rollback cliff                                   |
| "It's faster to write it all at once"             | It feels faster until the first bug takes 2 hours to locate in a 400-line diff                                      |
| "The slices are too small to be meaningful"       | If a slice compiles, passes tests, and moves toward the goal, it's meaningful                                       |
| "I need to see the whole picture first"           | Read the plan first, then implement slice by slice. Understanding ≠ building all at once                            |

## Overview

Large implementations fail because errors compound. When you write 500 lines before running anything, each line can introduce a bug that interacts with bugs from other lines. Thin vertical slices keep the error surface small.

**Core principle:** Working code at every step. Never be more than one slice away from a green build.

## The Cycle

```
FOR each slice:
  1. IMPLEMENT — Write the minimal code for this slice (1-3 files max)
  2. VERIFY — Run typecheck + lint + relevant tests
  3. COMMIT — Create a checkpoint with descriptive message
  4. NEXT — Move to the next slice

IF verify fails:
  Fix within the current slice before moving on
  Do NOT proceed to the next slice with broken code
```

## Slicing Strategies

### Vertical Slice (Preferred)

Each slice delivers one thin path through the full stack:

```
Slice 1: API endpoint returns hardcoded data → test passes
Slice 2: API endpoint reads from database → test passes
Slice 3: UI calls API and renders data → test passes
Slice 4: Add validation and error handling → test passes
```

### Contract-First

Define interfaces first, then implement behind them:

```
Slice 1: Define types/interfaces → compiles
Slice 2: Implement with stubs → tests pass (with mocked data)
Slice 3: Replace stubs with real implementation → tests pass
```

### Risk-First

Implement the hardest or most uncertain part first:

```
Slice 1: The tricky algorithm or integration → tests pass
Slice 2: The straightforward plumbing → tests pass
Slice 3: The UI/presentation layer → tests pass
```

## Implementation Rules

### 1. Simplicity First

Default to the simplest viable solution for each slice.

```
❌ "Let me add a factory pattern for extensibility"
✅ "Direct function call works. Refactor to pattern IF a second use case appears"
```

### 2. Scope Discipline

Each slice does ONE thing. If you notice something else that needs fixing:

```
NOTICED BUT NOT TOUCHING: [description of unrelated improvement]
```

Log it and continue with the current slice.

### 3. One Compilable Step at a Time

Never leave the codebase in a state where typecheck fails between slices.

```
❌ Add 5 function signatures, then implement all 5
✅ Add and implement function 1, verify, then function 2
```

### 4. Keep Tests Green

If existing tests break from your change, fix them in the same slice — not in a "fix tests" slice later.

### 5. Feature Flags for Incomplete Features

If a slice can't be hidden behind existing abstractions:

```typescript
// Temporary gate — remove when feature is complete
if (process.env.ENABLE_NEW_FEATURE) {
  // new code path
} else {
  // existing behavior
}
```

### 6. Rollback-Friendly

Each committed slice should be independently revertable without breaking the build.

## Slice Size Guide

| Slice Size    | Signal                                     |
| ------------- | ------------------------------------------ |
| 1-30 lines    | Ideal — easy to review and verify          |
| 30-100 lines  | Acceptable — still isolatable              |
| 100-200 lines | Too large — find a split point             |
| 200+ lines    | Stop. You're doing big-bang implementation |

## Red Flags — STOP

If you catch yourself:

- Writing more than 100 lines without running verification
- Saying "I'll test this after I finish the next part"
- Having 3+ files with uncommitted changes
- Building a complex abstraction before the simple version works
- Skipping verification because "this slice is trivial"

**STOP.** Verify what you have. Commit if it passes. Then continue.

## Verification

After each slice:

```bash
# Minimum verification (must pass)
npm run typecheck   # or equivalent
npm run lint        # or equivalent

# If slice changes behavior
npm test            # relevant test files
```

After all slices complete:

```bash
# Full verification
npm run typecheck && npm run lint && npm test
```

## Integration with Other Skills

- **test-driven-development** — Write the test for each slice FIRST (RED), then implement (GREEN)
- **verification-before-completion** — Run full gates after the final slice
- **code-simplification** — Refactor AFTER all slices pass, not during implementation
- **systematic-debugging** — If a slice fails verification, debug systematically instead of guessing

## See Also

- **writing-plans** — Creates the plan that this skill executes slice-by-slice
- **executing-plans** — Orchestrates parallel execution of independent slices
