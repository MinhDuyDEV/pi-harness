---
name: code-simplification
description: Use when reducing code complexity, eliminating dead code, or refactoring for clarity — enforces measure-before-cutting discipline to prevent breaking changes disguised as cleanup
version: 1.0.0
tags: [code-quality, refactoring]
dependencies: [verification-before-completion]
---

# Code Simplification

> **Replaces** ad-hoc "cleanup" refactors that introduce bugs — enforces systematic simplification with verification at every step

## When to Use

- Code is harder to understand than it needs to be
- Functions are too long (>50 lines), files are too large (>500 lines)
- Dead code, unused imports, or unnecessary abstractions exist
- You're asked to "clean up" or "simplify" a module
- Complexity is making bugs harder to fix

## When NOT to Use

- The code works, is readable, and isn't blocking anything — leave it alone
- You're implementing a new feature (use incremental-implementation instead)
- The "simplification" is actually a rewrite with different behavior

## Common Rationalizations

| Rationalization                        | Rebuttal                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| "This code is ugly, let me rewrite it" | Ugly but working > beautiful but broken. Simplify incrementally, not wholesale           |
| "Nobody uses this, I'll delete it"     | Verify with grep/find-references FIRST. "Nobody uses this" is the #1 cause of breakage   |
| "I'll simplify it while I'm in here"   | Mixing feature work with refactoring makes both harder to review and revert              |
| "This abstraction isn't needed"        | Check if it serves a testing, extension, or boundary purpose before removing             |
| "I can make this more elegant"         | Elegant for whom? Optimize for the next reader, not for cleverness                       |
| "The tests will catch any issues"      | Tests cover known behavior. Simplification can change behavior in ways tests don't cover |

## Overview

Code simplification is the discipline of making code easier to understand and maintain WITHOUT changing its behavior. The key word is discipline — undisciplined simplification introduces bugs.

**Core principle:** Measure complexity, simplify the worst offender, verify nothing broke, repeat.

## The Process

```
1. MEASURE  — Identify what's actually complex (not just what feels complex)
2. ISOLATE  — Pick ONE simplification target
3. VERIFY   — Ensure tests exist for current behavior
4. SIMPLIFY — Apply the smallest change that reduces complexity
5. CONFIRM  — Run full verification to prove behavior is unchanged
6. REPEAT   — Pick the next target
```

## Complexity Signals

| Signal                | Threshold        | Action                                      |
| --------------------- | ---------------- | ------------------------------------------- |
| Function length       | >50 lines        | Extract helper functions                    |
| File length           | >500 lines       | Split into modules                          |
| Nesting depth         | >3 levels        | Flatten with early returns or extract       |
| Parameter count       | >4 params        | Use an options object                       |
| Cyclomatic complexity | >10 per function | Break into smaller functions                |
| Dead code             | Any              | Remove after verifying with find-references |
| Unused imports        | Any              | Remove (linter usually catches these)       |
| Duplicate code        | 3+ copies        | Extract shared function                     |

## Simplification Patterns

### Extract Function

```typescript
// BEFORE: Long function with embedded logic
function processOrder(order: Order) {
  // 20 lines of validation
  // 15 lines of pricing
  // 10 lines of notification
}

// AFTER: Named steps
function processOrder(order: Order) {
  validateOrder(order);
  const total = calculateTotal(order);
  notifyCustomer(order, total);
}
```

### Early Return (Flatten Nesting)

```typescript
// BEFORE: Deep nesting
function getUser(id: string) {
  if (id) {
    const user = db.find(id);
    if (user) {
      if (user.active) {
        return user;
      }
    }
  }
  return null;
}

// AFTER: Guard clauses
function getUser(id: string) {
  if (!id) return null;
  const user = db.find(id);
  if (!user) return null;
  if (!user.active) return null;
  return user;
}
```

### Remove Dead Code

```
1. Search: grep/find-references for the symbol
2. Verify: No callers exist (check tests too)
3. Remove: Delete the code
4. Confirm: All tests still pass
```

**NEVER assume code is dead without searching.** Check:

- Direct calls
- Dynamic references (string-based lookups, reflection)
- Test-only usage
- Configuration references

### Inline Unnecessary Abstraction

```typescript
// BEFORE: Wrapper that adds nothing
function getUserName(user: User): string {
  return user.name;
}

// AFTER: Just use the property directly
user.name;
```

Only inline if the abstraction doesn't serve a testing, boundary, or extension purpose.

### Replace Conditional with Early Exit

```typescript
// BEFORE
function handle(input: string) {
  let result = "";
  if (isValid(input)) {
    result = transform(input);
  } else {
    throw new Error("Invalid");
  }
  return result;
}

// AFTER
function handle(input: string) {
  if (!isValid(input)) throw new Error("Invalid");
  return transform(input);
}
```

## What NOT to Simplify

- **Working error handling** — even if verbose, it's there for a reason
- **Compatibility shims** — they exist because something needs them
- **Performance-critical paths** — "simpler" may mean "slower"
- **Code with extensive test coverage pointing at specific behavior** — the tests document WHY it's complex
- **Other people's current work** — don't simplify files with active PRs

## Red Flags — STOP

If you catch yourself:

- Changing behavior while "simplifying"
- Removing code without checking references first
- Simplifying more than one thing per commit
- "Cleaning up" files you weren't asked to touch
- Making the code "more elegant" without a clear readability improvement

**STOP.** Revert the current change and pick a smaller target.

## Verification

Before each simplification:

```bash
# Ensure tests exist for current behavior
npm test -- --related [file]
```

After each simplification:

```bash
npm run typecheck
npm run lint
npm test
```

**If ANY test fails, the simplification changed behavior.** Either:

1. The simplification is wrong — revert it
2. The test is testing implementation details — fix the test, but document WHY

## See Also

- **incremental-implementation** — Build new features in slices; simplify afterward
- **systematic-debugging** — When simplification reveals hidden bugs
- **defense-in-depth** — When simplifying validation, ensure all layers still hold
