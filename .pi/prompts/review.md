---
description: Review code changes for bugs, security issues, and best practices
argument-hint: "[file or path] [--severity P0-P3]"
---

# Review: $ARGUMENTS

Review code for correctness, security, performance, and style.

## Load Skills

```typescript
skill({ name: "verification-before-completion" });
```

## Delegation

Delegate to the reviewer subagent for comprehensive analysis:

```typescript
Agent({
  subagent_type: "reviewer",
  description: "Review code changes",
  prompt:
    "Review the following code/changes: $ARGUMENTS\n\nProvide severity-ranked findings (P0-P3). Every finding must cite file:line evidence and impact scenario. Focus on: correctness, security, performance, and maintainability.",
});
```

## Output Format

Report findings in priority order:

| Severity | Meaning |
|----------|---------|
| **P0** | Critical — security vulnerability, data loss, crash |
| **P1** | High — incorrect behavior, race condition, memory leak |
| **P2** | Medium — performance issue, missing validation, poor error handling |
| **P3** | Low — style, naming, minor cleanup |

Each finding: `[severity] file:line — description — impact — suggested fix`
