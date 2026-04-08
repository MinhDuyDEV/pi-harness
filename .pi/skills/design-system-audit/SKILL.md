---
name: design-system-audit
description: Use when auditing an existing design system for consistency — token audits, pattern analysis, visual comparison against design specs. Load AFTER implementation to review, not during initial build.
version: 2.0.0
tags: [design, audit, ui]
dependencies: []
---

# Design System Audit

> **Replaces** separate, overlapping design review skills — unified design analysis covering UI patterns, design tokens, and visual properties

Use this skill for end-to-end design analysis across code, screenshots, and design specs.

## When to Use

- Auditing UI consistency across a component library or app
- Documenting existing patterns before refactor or migration
- Extracting/validating design tokens from implementation and visuals
- Comparing rendered output against mockups/Figma/screenshots

## When NOT to Use

- Pure backend work with no user-facing UI
- One-off micro tweak where system-level consistency is irrelevant

## Modes

### UI Pattern Analysis
Analyze component patterns, identify inconsistencies, document undocumented patterns.

Focus areas:

- Component variants and usage drift
- Repeated interaction patterns (forms, tables, dialogs, navigation)
- Pattern ownership (where canonical implementation should live)
- Inconsistent states (hover/focus/disabled/error/loading)

Deliverables:

- Pattern inventory with file references
- Consolidation candidates
- Priority fixes by user impact

### Design Token Audit
Extract and verify color, typography, spacing tokens against implementation.

Focus areas:

- Color token usage vs one-off literals
- Typography scale consistency (size/weight/line-height)
- Spacing/radius/shadow value normalization
- Semantic token gaps (text-muted, border-subtle, success, warning, etc.)

Deliverables:

- Token map (source of truth + current usage)
- Drift report (where implementation diverges)
- Proposed canonical token set and migration order

### Visual Comparison
Compare rendered output against mockups/specs with specific measurements.

Focus areas:

- Pixel-level spacing/sizing mismatches
- Color differences (hex-level)
- Typography mismatches (font, size, weight, line height)
- Layout/responsive behavior across breakpoints

Deliverables:

- Spec-vs-implementation discrepancy list
- Severity-ranked visual defects
- Concrete fix list with measurable targets

## Recommended Workflow

1. **Scope**
   - Identify target surfaces (pages/components/states/breakpoints)
   - Gather artifacts (code paths, screenshots, mockups)

2. **Inventory**
   - Capture pattern and token inventory from code + visuals
   - Note duplicates, drift, and undocumented conventions

3. **Cross-Reference**
   - Validate findings against design system tokens/components
   - Distinguish intentional exceptions from accidental drift

4. **Measure**
   - Record measurable values for each issue:
     - hex color
     - px/rem size
     - spacing/gap/padding values
     - breakpoint-specific behavior

5. **Report**
   - Produce actionable findings with file:line and target value
   - Group by severity and migration effort

## Audit Output Template

```markdown
## Design Audit: [Scope]

### Findings
1. [Severity] [Issue]
   - File: `path/to/file.tsx:123`
   - Current: `#6B7280`, `14px`, `gap: 10px`
   - Expected: `var(--color-text-muted)`, `13px`, `gap: 8px`
   - Impact: [consistency/accessibility/brand mismatch]

### Token Drift Summary
- Colors: X one-offs, Y missing semantic mappings
- Typography: X non-scale values
- Spacing: X non-token values

### Priority Actions
- P0: [high impact, low effort]
- P1: [high impact, medium effort]
- P2: [design debt cleanup]
```

## Anti-Patterns

| Anti-Pattern | Why It Hurts | Better Approach |
| --- | --- | --- |
| Vague feedback ("looks good") instead of specific measurements | Not actionable, impossible to verify | Report concrete values (hex, px/rem, exact delta) |
| Not checking existing design tokens before proposing new values | Creates token sprawl and inconsistency | Map to existing tokens first; add new tokens only when justified |
| Auditing in isolation without cross-referencing the design system | Flags intentional patterns as bugs | Validate each finding against canonical component/token sources |
| Reporting visual issues without checking responsive breakpoints | Misses major UX regressions on mobile/tablet | Verify each issue across defined breakpoints and states |

## Verification

After audit: every finding should reference a specific file:line and measurable value (hex color, px size, etc.)

Minimum quality gate:

- Each finding has location + current value + expected value
- Each recommendation maps to token/system guidance
- Responsive states checked for impacted components

## Storage

- Save audits to `.opencode/memory/design/audits/`
- Save extracted token snapshots to `.opencode/memory/design/tokens/`

## See Also

- `mockup-to-code`
- `frontend-design`
- `accessibility-audit`
