# Behavioral Kernel Examples

Concrete bad-vs-good examples for the Pi-native behavioral kernel.

---

## 1. Clarify before committing

### Bad

User: "Add export for user data."

Agent silently chooses:
- export all users
- CSV file on disk
- fields `id`, `email`, `name`
- no privacy filtering

### Good

Agent says:
- Scope is ambiguous: all users vs filtered subset.
- Delivery is ambiguous: API response vs downloadable file vs background job.
- Fields may include sensitive data.

Then asks the smallest clarifying question or states the reversible assumption it will use.

---

## 2. Choose the smallest working change

### Bad

User: "Add a discount helper."

Agent builds:
- `DiscountStrategy`
- `PercentageDiscount`
- `FixedDiscount`
- config objects
- factories
- extension hooks

### Good

Agent writes:

```ts
export function calculateDiscount(amount: number, percent: number) {
  return amount * (percent / 100);
}
```

Then stops until a second real use case demands more structure.

---

## 3. Keep diffs surgical

### Bad

User: "Fix empty email crash."

Agent also:
- rewrites comments
- reforms quote style
- adds username validation
- renames local variables unrelated to the bug

### Good

Agent changes only the email handling path and leaves surrounding style and behavior alone.

If it notices unrelated dead code, it records:

```text
NOTICED BUT NOT TOUCHING: stale username helper in src/user/validate.ts
```

---

## 4. Define proof before acting

### Bad

User: "Fix auth logout bug."

Agent says: "I'll patch it and test later."

### Good

Agent says:

1. Reproduce: change password and verify old session still works.
2. Implement: invalidate sessions on password change.
3. Verify: reproduction test now fails before fix and passes after fix.
4. Re-run nearby auth tests to catch regressions.

The implementation starts only after the proof path is named.

---

## 5. Recover from drift

### Drift signal

You are 150 lines into a change and have not run typecheck or tests.

### Recovery

- Re-state the task in one sentence.
- Cut back to the smallest working slice.
- Run the proof path now.
- Only then continue.

---

## Rule of thumb

If you cannot answer all four questions in one breath, stop and reset:

1. What exactly am I changing?
2. Why is this the smallest viable change?
3. What am I explicitly not touching?
4. How will I prove I am done?
