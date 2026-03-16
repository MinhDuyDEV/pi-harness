---
description: Refactor code for clarity, performance, or maintainability
argument-hint: "<file or path> [--scope minimal|moderate|aggressive]"
---

# Refactor: $ARGUMENTS

Improve code quality without changing external behavior.

## Load Skills

```typescript
skill({ name: "verification-before-completion" });
```

## Process

### Phase 1: Assess

- Read the target code thoroughly
- Identify specific issues (duplication, complexity, naming, coupling)
- Check blast radius with `tilth_deps` before changing exports/signatures
- Run existing tests to establish baseline

### Phase 2: Plan

Present the refactoring plan before executing:

| Category | What | Why | Risk |
|----------|------|-----|------|
| ... | ... | ... | ... |

Wait for user approval on the plan.

### Phase 3: Execute

Apply changes in small, verifiable steps:

1. Make one logical change
2. Run tests — must pass
3. Repeat

Follow the scope level:
- **minimal**: Rename, extract, inline — no structural changes
- **moderate**: Restructure within files, split large functions
- **aggressive**: Cross-file restructuring, interface changes

### Phase 4: Verify

- All existing tests pass
- Typecheck passes
- No behavior changes (same inputs → same outputs)
- Lint passes

## Rules

- Never change behavior — refactor only
- Run tests after each change, not just at the end
- If a test fails, revert the last change and investigate
- Ask before architectural changes (new files, moved exports, changed interfaces)
