---
name: deprecation-and-migration
description: Use when deprecating APIs, migrating between library versions, removing legacy code, or planning breaking changes — covers deprecation notices, migration guides, codemods, and staged rollout
version: 1.0.0
tags: [architecture, workflow]
dependencies: []
---

# Deprecation & Migration

> **Replaces** sudden breaking changes with structured, communicable transitions that give consumers time to adapt

## When to Use

- Deprecating an API endpoint, function, or module
- Migrating between major library/framework versions
- Removing legacy code paths or feature flags
- Planning breaking changes across multiple consumers

## When NOT to Use

- Internal refactors that don't affect any public API or consumer
- Bug fixes that change behavior (that's a fix, not a migration)
- Adding new features alongside existing ones (no deprecation needed)

## Overview

Deprecation is a communication protocol. Migration is the execution plan. Both must be explicit, gradual, and reversible until the cutover point.

**Core principle:** Never remove without warning. Never warn without a replacement. Never migrate without a rollback plan.

## Deprecation Process

```
1. ANNOUNCE  — Mark as deprecated with notice + replacement + timeline
2. PROVIDE   — Ship the replacement alongside the deprecated code
3. MIGRATE   — Help consumers move (codemods, guides, examples)
4. MONITOR   — Track usage of deprecated paths
5. REMOVE    — Remove only after usage drops to zero (or deadline passes)
```

## Deprecation Notices

### In Code

```typescript
/**
 * @deprecated Use `createUser()` instead. Will be removed in v3.0.
 * Migration guide: https://docs.example.com/migrate-v3
 */
export function addUser(name: string): User {
  console.warn(
    "addUser() is deprecated. Use createUser() instead. See: https://docs.example.com/migrate-v3",
  );
  return createUser({ name });
}
```

### Checklist

- [ ] `@deprecated` JSDoc tag with replacement name
- [ ] Runtime warning on first call (not every call — use a flag)
- [ ] Migration guide URL in the deprecation message
- [ ] Removal version/date specified
- [ ] TypeScript: mark with `@deprecated` for IDE strikethrough

## Migration Guide Template

```markdown
# Migration: v2 → v3

## Breaking Changes

| Change                   | Before          | After                  | Effort |
| ------------------------ | --------------- | ---------------------- | ------ |
| `addUser` → `createUser` | `addUser(name)` | `createUser({ name })` | S      |
| Config format changed    | `config.key`    | `config.settings.key`  | M      |

## Step-by-Step

1. Update dependency: `npm install pkg@3.0.0`
2. Run codemod: `npx pkg-migrate v2-to-v3`
3. Manual fixes: [list of manual changes]
4. Verify: `npm test && npm run typecheck`

## Rollback

If issues arise: `npm install pkg@2.x.x` — v2 APIs still work until v4.

## Timeline

- v2.5.0: Deprecation warnings added
- v3.0.0: New API shipped, old API still works with warnings
- v3.5.0: Old API removed (6 months after v3.0.0)
```

## Codemod Patterns

### Simple Find & Replace

```typescript
// jscodeshift transform
export default function transformer(file, api) {
  const j = api.jscodeshift;
  return j(file.source)
    .find(j.CallExpression, { callee: { name: "addUser" } })
    .forEach((path) => {
      path.node.callee.name = "createUser";
      // Wrap string arg in object: addUser("name") → createUser({ name: "name" })
      const arg = path.node.arguments[0];
      path.node.arguments = [j.objectExpression([j.property("init", j.identifier("name"), arg)])];
    })
    .toSource();
}
```

### When to Write a Codemod

| Consumers       | Change Complexity   | Write Codemod?                             |
| --------------- | ------------------- | ------------------------------------------ |
| 1-5 call sites  | Simple rename       | No — manual is faster                      |
| 5-20 call sites | Simple rename       | Maybe — saves time and ensures consistency |
| 20+ call sites  | Any change          | Yes — manual migration is error-prone      |
| Any count       | Complex restructure | Yes — reduce human error                   |

## Staged Rollout

```
Phase 1: Ship new API alongside old (backward compatible)
  └── Duration: 1-2 release cycles
  └── Verify: New API works, old API still works

Phase 2: Add deprecation warnings to old API
  └── Duration: 2-4 release cycles
  └── Monitor: Track warning frequency, identify stragglers

Phase 3: Remove old API
  └── Only when: Usage is zero OR deadline passed
  └── Verify: No references remain in codebase
  └── Rollback: Revert removal if unexpected breakage
```

## Common Rationalizations

| Excuse                                 | Rebuttal                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| "Nobody uses the old API"              | Prove it with usage data. Assumption ≠ evidence.                                   |
| "It's an internal API, just change it" | Internal consumers break too. Deprecate or coordinate.                             |
| "Deprecation warnings are noisy"       | That's the point — they surface migration debt before it becomes an emergency.     |
| "We'll document later"                 | Undocumented breaking changes cause support load that dwarfs documentation effort. |
| "The codemod is too much work"         | One codemod saves N manual migrations. Calculate the actual ROI.                   |
| "Just bump the major version"          | A version bump without a migration path is abandonment, not deprecation.           |

## Feature Flag Cleanup

Feature flags are a form of deprecation — they accumulate if not cleaned up.

```
1. Deploy feature behind flag (OFF)
2. Enable for team → canary → percentage → 100%
3. Once stable at 100%: REMOVE the flag
4. Delete: flag definition, branching code, old code path
5. Verify: tests pass without the flag
```

**Flag lifecycle max:** 30 days at 100% before cleanup is mandatory.

## Red Flags — STOP

- Breaking change shipped without deprecation period
- Deprecated code removed before usage reaches zero
- No migration guide or codemod for complex changes
- Feature flags older than 90 days without cleanup plan
- Runtime deprecation warnings suppressed instead of addressed

## Verification

- [ ] Deprecated APIs have `@deprecated` tags with replacement
- [ ] Runtime warnings fire on deprecated API usage
- [ ] Migration guide exists with step-by-step + rollback
- [ ] Usage of deprecated paths is tracked/monitored
- [ ] Feature flags have documented cleanup dates
- [ ] Codemod written for changes affecting 20+ call sites

## See Also

- **api-and-interface-design** — Designing APIs that minimize future deprecation
- **incremental-implementation** — Migrating in thin vertical slices
- **documentation-and-adrs** — Recording the decision to deprecate/migrate
