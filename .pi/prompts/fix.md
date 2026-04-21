---
description: Debug and fix a bug or failing test
argument-hint: "<description of bug or error>"
---

# Fix: $ARGUMENTS

Systematically debug and fix the reported issue.

## Load Skills

```typescript
skill({ name: "systematic-debugging" });
skill({ name: "root-cause-tracing" });
skill({ name: "behavioral-kernel" });
skill({ name: "verification-before-completion" });
```

## Process

### Phase 1: Reproduce

- Identify the failing behavior from the description
- Run the relevant test/command to reproduce
- Capture the exact error output

### Phase 2: Root Cause

- Trace backward from the error to find the source
- Check recent changes (`git diff`, `git log --oneline -10`)
- Identify the minimal failing case

### Phase 3: Fix

- Apply the behavioral kernel: surface assumptions before changing code, keep the fix to the smallest working slice, state what is explicitly out of scope, and name the proof path before editing
- Apply the minimal fix that addresses root cause (not symptoms)
- Auto-fix related issues found during investigation (deviation rules 1-3)
- Stop and ask about architectural changes (deviation rule 4)

### Phase 4: Verify

- Run the failing test/command — must pass
- Run related tests — must not regress
- Run typecheck/lint if applicable

## Output

1. **Root cause**: What was wrong and why
2. **Fix applied**: What changed (file:line references)
3. **Verification**: Command output proving the fix works
4. **Related**: Any other issues found during investigation
