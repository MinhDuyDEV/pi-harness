---
name: improve-codebase-architecture
description: Behavior-preserving architecture refactoring and deep-module design — risk-ordered ladder, interface depth, code-smell table, strangler fig. Use when modules are tightly coupled, interfaces are shallow, tests are hard to write, or one change touches many files.
metadata:
  version: 1.0.0
---

# Improve Codebase Architecture

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Architecture change = behavior-preserving.** Tests stay green.
- **One axis at a time.** Not naming + layering + packaging in one PR.
- **Each step independently shippable.** Strangler fig, not big-bang.
- **Measure before and after.** Cyclomatic complexity, coupling, build time.
- **Make easy changes easy, hard changes possible.** Not "perfect". Just better.
</EXTREMELY-IMPORTANT>

## When to Use

"Improve the architecture"; module too coupled; tests hard to write; "this class is too big"; AI tools struggle; build/test time high; on-boarding painful.

## When NOT to Use

Architecture is fine; "redesign" without a problem; rewrites (different risk); user wants features.

## The Refactoring Ladder

```
1. Rename    (~hours, high signal)
2. Extract   (~hours)
3. Move      (~hours)
4. Restructure (interface, layering — ~days)
5. Repackage (~weeks)
6. Rewrite   (~months)
```

Start at the bottom. Don't jump to 5.

## Approach

1. **Identify the smell.** Don't refactor what isn't broken.
2. **Measure baseline.** Coupling, complexity, build time. Record.
3. **Pick the smallest change.** One rename, extract, or move.
4. **Verify behavior preserved.** Tests pass.
5. **Measure again.** Did the metric improve?
6. **Commit.** One commit per change.
7. **Repeat.** Or stop.

## Common Smells

| Smell | Indicator | First move |
|---|---|---|
| Long method | > 30 lines, multiple responsibilities | Extract method |
| God class | 1000+ lines, 20+ methods | Extract class |
| Tight coupling | Changing A forces changes in B | Dependency injection |
| Feature envy | Method uses B's data more | Move method to B |
| Primitive obsession | Strings/numbers for domain | Value objects / branded |
| Long parameter list | > 3 params, especially bools | Parameter object / options |
| Shotgun surgery | One change touches 5+ files | Consolidate |
| Divergent change | One class changes for many reasons | Split by axis |

## Module Boundaries

**Good**: single purpose, small interface, changes localized, testable.
**Bad**: two things, wide interface, one change touches many files, tests mock the world.

## When to Stop

Stop if tests are easy to write, build time decreased, new features easy, onboarding faster, AI tools navigate. Continue otherwise.

## Strangler Fig Pattern

For larger refactors:
1. **Build new alongside old.** Both work.
2. **Route traffic incrementally.** 10% → 50% → 100%.
3. **Remove old path.** Once 100% on new.
4. **One piece at a time.** Module by module.

## Module-depth check

When a slice changes a public boundary, evaluate whether the module hides substantially more complexity than its callers must learn. Use `references/deep-module-design.md` for the Depth Metric, interface alternatives, and warning signs. Keep a boundary shallow when independent ownership, security, or failure isolation requires it.

## References

- See [LANGUAGE.md](LANGUAGE.md) for the shared vocabulary (module, interface, seam, adapter, leverage) — use these terms exactly.
- See [DEEPENING.md](DEEPENING.md) for deepening a cluster of shallow modules safely, by dependency category.
- See [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md) for the design-it-twice parallel sub-agent pattern when exploring alternative interfaces.
- See [references/deep-module-design.md](references/deep-module-design.md) for focused interface-depth analysis.
- See [references/api-interface-design.md](references/api-interface-design.md) for API compatibility, errors, and evolution.
- See [HTML-REPORT.md](HTML-REPORT.md) for rendering an architectural review as a self-contained HTML report.
- ADR format is owned by `documentation-and-adrs`; CONTEXT.md format by `grill-me` (each under `references/`).

## Red Flags

Refactoring without tests; no baseline measurement; "I think this is better" (no metric); jumping to rewrite; multiple axes in one PR; refactor mixed with feature work; "perfect is the enemy" over-polish; rename without a target vocabulary; "moved it, so it's better" (no proof).
