---
name: testing-anti-patterns
description: Catches tests that prove nothing — tautologies, mock-only assertions, test-only production methods. Use when writing or changing tests, adding mocks, or when a test would pass with the body deleted.
metadata:
  version: 1.0.0
  tags:
  - testing
  - code-quality
  dependencies: []
---

# Testing Anti-Patterns

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Test behavior, not mocks.** Asserting the mock was called tests the mock, not your code.
- **No test-only methods in production.** If a method exists only for tests, the design is wrong.
- **Mock at the seam.** Mock the interface, not the internals.
- **One intent per test.** Multiple `expect`s OK if they verify one outcome.
- **Tests must fail for the right reason.** A test that catches a typo is a tautology.
</EXTREMELY-IMPORTANT>

## Tautology Tests (Worst)

```ts
// BAD: tests nothing
test("returns input", () => {
  const result = identity(42)
  expect(result).toBe(42) // function is `x => x`
})
```

A tautology passes when the code is broken, as long as the brokenness matches. Catch: would this fail if I deleted the function body?

## Test-Only Methods in Production

```ts
// BAD
class UserService {
  async findUser(id: string) { /* ... */ }
  _resetCache() { this.cache.clear() } // for tests only
  _getInternalState() { return this.state }
}

// GOOD: test seam via DI
class UserService {
  constructor(private cache: Cache) {}
}
```

If a method exists only for tests, your test is coupled to implementation. Fix the design, not the test.

## Mocking the Behavior You Test

```ts
// BAD
test("save calls save endpoint", () => {
  const api = { save: jest.fn().mockResolvedValue({ ok: true }) }
  const repo = new UserRepo(api)
  repo.save({ name: "Alice" })
  expect(api.save).toHaveBeenCalled() // tests the mock, not the repo
})

// GOOD
test("save persists user", async () => {
  const api = { save: jest.fn().mockResolvedValue({ ok: true }) }
  const repo = new UserRepo(api)
  const result = await repo.save({ name: "Alice" })
  expect(result).toEqual({ ok: true, user: { name: "Alice" } })
})
```

The second catches a bug where the repo didn't await, didn't handle errors, or returned the wrong shape. The first wouldn't.

## Mocking Without Understanding

```ts
// BAD: mock the entire dependency
jest.mock("../db")
// Every test uses a mock. Tests pass. Production breaks.
```

Mocks that hide too much test the wiring, not the behavior. Rule: if you can't explain what the real dep does, write a contract test against the real one first.

## Red Flags

Test passes when the function body is deleted (tautology); test asserts only `toHaveBeenCalled`; `_method` in production for tests; `jest.mock` blanketing a whole dependency without a contract test; shared `beforeEach` mutation; tests that depend on each other; snapshot tests without stated intent; testing private methods via casts; asserting call order without need.

## Anti-rationalization

| Shortcut the model reaches for | Why it fails here |
|---|---|
| "The mock returns what the real thing would" | You're testing the mock's promise, not real behavior; the test passes when the real code breaks. |
| "I need this method for the test" | A test-only method in production pollutes production for tests; test through the real interface. |
| "Tautology tests are better than none" | A tautology test gives false confidence + blocks real tests; delete it, write a real one. |
