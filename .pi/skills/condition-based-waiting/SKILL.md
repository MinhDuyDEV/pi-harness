---
name: condition-based-waiting
description: Use when tests have race conditions, timing dependencies, or inconsistent pass/fail behavior - replaces arbitrary timeouts with condition polling to wait for actual state changes, eliminating flaky tests from timing guesses
version: 1.0.0
tags: [testing, debugging]
dependencies: []
---

# Condition-Based Waiting

> **Replaces** arbitrary `sleep()` / `setTimeout()` calls and hardcoded delays that cause flaky tests and slow CI

## When to Use

- Tests are flaky due to arbitrary delays or timing guesses
- You need to wait for async state changes (events, file writes, state transitions)

## When NOT to Use

- You are explicitly testing timing behavior (debounce, throttle, intervals)
- A fixed, documented timeout is part of the requirement

## Common Rationalizations

| Rationalization                               | Rebuttal                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| "50ms is plenty of time"                      | It's plenty on YOUR machine. CI runners under load disagree                    |
| "The sleep worked in local testing"           | Local = fast SSD, idle CPU. CI = shared resources, variable latency            |
| "Adding a waitFor is more complex than sleep" | A 5-line waitFor is simpler than debugging a flaky test 10 times               |
| "This operation is always fast"               | "Always" until garbage collection, disk I/O, or network latency says otherwise |
| "I'll increase the timeout if it flakes"      | Increasing timeouts slows the entire suite and masks the real problem          |
| "It only fails sometimes"                     | "Sometimes" = race condition. Condition-based waiting eliminates it entirely   |

## Overview

Flaky tests often guess at timing with arbitrary delays. This creates race conditions where tests pass on fast machines but fail under load or in CI.

**Core principle:** Wait for the actual condition you care about, not a guess about how long it takes.

## Core Pattern

```typescript
// ❌ BEFORE: Guessing at timing
await new Promise((r) => setTimeout(r, 50));
const result = getResult();
expect(result).toBeDefined();

// ✅ AFTER: Waiting for condition
await waitFor(() => getResult() !== undefined);
const result = getResult();
expect(result).toBeDefined();
```

## Quick Patterns

| Scenario          | Pattern                                              |
| ----------------- | ---------------------------------------------------- |
| Wait for event    | `waitFor(() => events.find(e => e.type === 'DONE'))` |
| Wait for state    | `waitFor(() => machine.state === 'ready')`           |
| Wait for count    | `waitFor(() => items.length >= 5)`                   |
| Wait for file     | `waitFor(() => fs.existsSync(path))`                 |
| Complex condition | `waitFor(() => obj.ready && obj.value > 10)`         |

## Implementation

Generic polling function:

```typescript
async function waitFor<T>(
  condition: () => T | undefined | null | false,
  description: string,
  timeoutMs = 5000,
): Promise<T> {
  const startTime = Date.now();

  while (true) {
    const result = condition();
    if (result) return result;

    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`);
    }

    await new Promise((r) => setTimeout(r, 10)); // Poll every 10ms
  }
}
```

See @example.ts for complete implementation with domain-specific helpers (`waitForEvent`, `waitForEventCount`, `waitForEventMatch`) from actual debugging session.

## Common Mistakes

**❌ Polling too fast:** `setTimeout(check, 1)` - wastes CPU
**✅ Fix:** Poll every 10ms

**❌ No timeout:** Loop forever if condition never met
**✅ Fix:** Always include timeout with clear error

**❌ Stale data:** Cache state before loop
**✅ Fix:** Call getter inside loop for fresh data

## When Arbitrary Timeout IS Correct

```typescript
// Tool ticks every 100ms - need 2 ticks to verify partial output
await waitForEvent(manager, "TOOL_STARTED"); // First: wait for condition
await new Promise((r) => setTimeout(r, 200)); // Then: wait for timed behavior
// 200ms = 2 ticks at 100ms intervals - documented and justified
```

**Requirements:**

1. First wait for triggering condition
2. Based on known timing (not guessing)
3. Comment explaining WHY

## Verification

- **After applying:** run the previously flaky test 5+ times — should pass consistently
- **Check:** no hardcoded sleep/delay values remain in the test file
- **Measure:** test execution time should decrease (no wasted wait time)

## Real-World Impact

From debugging session (2025-10-03):

- Fixed 15 flaky tests across 3 files
- Pass rate: 60% → 100%
- Execution time: 40% faster
- No more race conditions

## See Also

- `systematic-debugging`
- `test-driven-development`
