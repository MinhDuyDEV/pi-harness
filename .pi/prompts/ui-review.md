---
description: Review UI/UX for quality, accessibility, and AI slop patterns
argument-hint: "<path> [--responsive] [--dark-mode] [--slop] [--staged] [--since=<ref>]"
agentType: vision
model: proxypal/gemini-3-pro-preview
---

# UI Review: $ARGUMENTS

Run a comprehensive UI/UX review. Two modes:

- **Default:** General quality audit — scores typography, color, layout, interactivity, accessibility, polish
- **`--slop`:** Targeted anti-AI-slop audit — scores AI-generated UI patterns and flags design-system violations

> Absorbed the old `/ui-slop-check` — use `--slop` for that behavior.

## Load Skills

```typescript
skill({ name: "mockup-to-code" }); // Analysis framework
skill({ name: "accessibility-audit" }); // WCAG checklists
skill({ name: "frontend-design" }); // Anti-patterns, design quality
```

## Input

Parse `$ARGUMENTS`:

| Argument | Description |
| --- | --- |
| `<path>` | Image, screenshot, component file, or directory |
| `--responsive` | Include responsive breakpoint review |
| `--dark-mode` | Include dark mode review |
| `--slop` | Run anti-AI-slop audit instead of general review |
| `--staged` | Review staged changes only (slop mode) |
| `--since=<ref>` | Review changes since a git ref (slop mode) |
| `--full-report` | Full slop report with code snippets (slop mode) |

---

# Default Mode: General UI Review

Use for reviewing any UI — image, screenshot, component, or page.

## Workflow

### 1. Analyze the Input

Use the `mockup-to-code` skill to perform deep analysis:

- Content inventory (elements, text, icons)
- Visual properties (colors, typography, spacing, layout)
- Design patterns and potential issues

### 2. Score Categories

Rate each 1-10 with brief justification:

| Category               | What to Evaluate                                               |
| ---------------------- | -------------------------------------------------------------- |
| **Typography**         | Hierarchy, readability, weight contrast, intentional choices   |
| **Color**              | Palette cohesion, contrast, semantic usage, no AI slop         |
| **Layout & Spacing**   | Visual hierarchy, consistency, alignment, white space          |
| **Interactive States** | Hover, focus, active, disabled, loading coverage               |
| **Accessibility**      | WCAG AA compliance (use `accessibility-audit` skill checklist) |
| **Visual Polish**      | Consistency, attention to detail, motion, shadows, icons       |

### 3. Conditional Reviews

**If `--responsive`**: Check at 375px, 768px, 1280px, 1536px+. Flag touch targets, horizontal scroll, text sizing.

**If `--dark-mode`**: Check contrast on dark backgrounds, adapted colors (not just inverted), shadow adjustments, focus visibility.

### 4. Report Findings

Group by severity:

- **Critical (Must Fix)**: Accessibility failures, broken interactions
- **Warning (Should Fix)**: AI slop patterns, inconsistent spacing, missing states
- **Info (Nice to Have)**: Polish opportunities

For each finding: location, impact, and recommended fix.

## Output (Default Mode)

1. Category scores (1-10 each) with justification
2. Overall assessment (1-2 sentences)
3. Findings grouped by severity with actionable fixes
4. Code fixes for critical issues (if reviewing component code)

---

# Slop Mode: Anti-AI-Slop Audit

Use `--slop` to run a targeted anti-slop audit against changed UI files using the frontend-design taxonomy.

> **When to use:** After AI-generated UI code, before committing, or when something looks "off" but you can't pinpoint it.

## Slop Mode Setup

Determine what to scan:

| Input | Action |
| --- | --- |
| `<path>` | Scan that file/directory |
| `--staged` | Scan staged changes: `git diff --cached --name-only` |
| `--since=<ref>` | Scan changes since ref: `git diff --name-only <ref> HEAD` |
| No args | Auto-detect: staged or modified files |

Filter for UI-related files only (`.tsx`, `.jsx`, `.css`, `.scss`, `.vue`, `.svelte`).

## Slop Categories

For each file, check these AI slop patterns from the frontend-design skill taxonomy:

| Category | What to Flag |
| --- | --- |
| **Typography** | `text-sm` on everything, no hierarchy, gray-on-gray, font-size/weight misuse |
| **Spacing** | Inconsistent gaps, missing padding containers, `gap-2` copy-paste everywhere |
| **Shadows** | `shadow-lg`/`shadow-xl` on everything, stacked shadows, glow effects |
| **Rounded corners** | `rounded-xl`/`rounded-2xl` as default, unnecessary rounding |
| **Borders** | `border` on everything, hairline 1px borders layered on shadows |
| **Gradients** | Purple-blue gradients, overused gradients, unnecessary gradient backgrounds |
| **Colors** | Blue-500 primary, gray-100 backgrounds, no semantic color tokens |
| **Icons** | Overlapping icons, icon-only buttons without labels, inconsistent sizes |
| **Layout** | Nested flex containers, unnecessary wrappers, over-sophisticated responsive patterns |
| **Dark mode** | Just inverted palettes, no adapted shadows/typography |

## Slop Score

Rate each file 0-10:

| Score | Meaning |
| --- | --- |
| 0-3 | Clean — minimal AI artifacts |
| 4-6 | Moderate — needs cleanup in specific areas |
| 7-8 | Heavy — multiple categories affected, should refactor |
| 9-10 | Critical — full of AI slop, needs rewrite |

## Output (Slop Mode)

Default (concise):

```
## Slop Summary

| File | Score | Top Issues |
| --- | --- | --- |
| src/components/Card.tsx | 6/10 | shadows, typography, spacing |
| src/pages/Dashboard.tsx | 3/10 | spacing |

## Top Findings
- [P1] Card.tsx: stacked shadows... |
- [P2] Dashboard.tsx: inconsistent spacing... |
```

With `--full-report`:

For each flagged file:
- Slop score
- Category breakdown (typography/spacing/shadows/etc)
- Code snippets with line numbers
- Before/after recommendations

## Slop Mode Red Flags

- Slop score > 7 without explicit design justification
- Same pattern appears in 3+ files without being extracted as a component
- File uses both Tailwind utility classes AND CSS modules AND inline styles
- Missing responsive variants (no `sm:`, `md:`, `lg:` prefixes)

## Record Findings

```typescript
observation({
  type: "warning",
  title: "UI: [Component] [issue type]",
  narrative: "Found [issue] in [location]. Impact: [description]...",
  concepts: "ui, accessibility, [category]",
  confidence: "high",
});
```

## Related Commands

| Need                 | Command   |
| -------------------- | --------- |
| Design from scratch  | `/design` |
| Ship implementation  | `/ship`   |
