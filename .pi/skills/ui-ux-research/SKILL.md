---
name: ui-ux-research
description: Use when analyzing UI patterns across codebases, comparing design system implementations, auditing UI consistency, or understanding existing patterns before implementation
version: 1.0.0
tags: [design, research]
dependencies: []
---

# UI/UX Research Skill

## When to Use

- Analyzing UI patterns across large codebases
- Comparing design system implementations
- Auditing UI consistency
- Understanding existing patterns before implementation

## When NOT to Use

- Single-file UI changes without broader pattern investigation.


## Research Patterns

### Find All UI Components

```
Analyze the components directory.
List all UI components with their props interfaces.
```

### Audit Design System Consistency

```
Check design token usage consistency:
- Colors
- Spacing
- Typography

Identify inconsistencies and suggest consolidation.
```

### Compare UI Implementations

```
Compare layout patterns across pages.
Identify inconsistencies and recommend standardization.
```

### Accessibility Audit

```
Audit components for WCAG compliance:
- Color contrast
- ARIA labels
- Keyboard navigation

Prioritize issues by severity.
```

### Responsive Design Review

```
Find all responsive breakpoints and media queries.
Assess mobile-first compliance.
Identify missing responsive considerations.
```

## Pattern Search Template

```
Has [PATTERN] been implemented?

Show:
1. Files containing the pattern
2. Implementation approach
3. Consistency across usages
4. Potential improvements
```

**Common patterns to search:**

- Dark mode toggle
- Form validation
- Loading states
- Error boundaries
- Toast notifications
- Modal dialogs
- Data tables

## Integration with Beads

For task-constrained research:

1. Check bead spec constraints
2. Research within those constraints
3. Save findings to bead artifacts

## Storage

Save research findings to `docs/design/research/`

## Output Format

```markdown
## Research: [Topic]

### Findings

[Key discoveries]

### Current Implementation

[What exists]

### Recommendations

[What to improve]

### Next Steps

[Actionable items]
```

## Related Skills

| After Research              | Use Skill             |
| --------------------------- | --------------------- |
| Need implementation         | `mockup-to-code`      |
| Need aesthetic improvements | `frontend-design`     |
| Need accessibility fixes    | `accessibility-audit` |
