---
description: Write or generate tests for code
argument-hint: "<file or function> [--unit|--integration|--e2e]"
---

# Test: $ARGUMENTS

Write tests for the specified code following TDD principles.

## Load Skills

```typescript
skill({ name: "test-driven-development" });
skill({ name: "testing-anti-patterns" });
skill({ name: "verification-before-completion" });
```

## Process

### Phase 1: Analyze

- Read the target code to understand its behavior
- Identify inputs, outputs, side effects, and edge cases
- Check for existing tests (don't duplicate)
- Determine the test framework in use (vitest, jest, pytest, go test, etc.)

### Phase 2: Plan Test Cases

List test cases before writing:

| Case | Input | Expected | Edge? |
|------|-------|----------|-------|
| ... | ... | ... | ... |

Prioritize:
1. Happy path (most common usage)
2. Error cases (invalid input, missing data)
3. Edge cases (empty, null, boundary values)
4. Integration points (if --integration)

### Phase 3: Write Tests (RED → GREEN → REFACTOR)

1. **RED**: Write the test first — run it — must fail
2. **GREEN**: Implement the minimal production change needed to make the failing test pass.
   - If you are only adding coverage for existing behavior, the new test may pass immediately — that is acceptable if it still provides new signal.
3. **REFACTOR**: Clean up test code, extract helpers if needed

### Phase 4: Verify

```bash
# Run just the new tests
[test-command] [test-file]

# Run full suite to check for regressions
[test-command]
```

## Anti-Patterns to Avoid

- Don't test mock behavior — test real behavior
- Don't add test-only methods to production code
- Don't mock what you don't understand
- Don't write tests that pass regardless of implementation
