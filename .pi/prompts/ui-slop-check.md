---
description: Audit changed UI files for AI slop patterns and design-system violations
argument-hint: "[path|auto] [--staged] [--since=<ref>] [--full-report]"
---

# UI Slop Check: $ARGUMENTS

Run a focused anti-slop audit against changed UI files using the frontend-design taxonomy.

## Parse Arguments

| Argument        | Default | Description                                                   |
| --------------- | ------- | ------------------------------------------------------------- |
| `[path|auto]`   | `auto`  | Specific file/dir to audit, or auto-detect changed UI files   |
| `--staged`      | false   | Audit staged changes only                                     |
| `--since=<ref>` | `HEAD`  | Compare against ref (`main`, `HEAD~1`, commit SHA)            |
| `--full-report` | false   | Include all categories even when no issues found              |

## Phase 1: Resolve Target Files

If `[path]` is provided, audit that path directly.

If `auto`:

```bash
git diff --name-only $SINCE_REF -- \
  '*.tsx' '*.jsx' '*.css' '*.scss' '*.sass' '*.less' '*.html' '*.mdx'
```

Prioritize files under: `src/components/`, `src/app/`, `src/pages/`, `app/`, `components/`

If no UI files changed, return: **PASS (no changed UI files)**.

## Phase 2: Run AI Slop Checklist

### A) Typography
- Banned default aesthetics (Inter/Roboto/Arial/Open Sans as dominant display voice)
- Body text uses `rem/em`, not fixed `px`
- Clear hierarchy (size/weight/spacing), not color-only hierarchy
- Body line length near readable measure (~65ch)

### B) Color and Theming
- No AI default palette tropes (purple-blue gradient defaults, neon-on-dark)
- No pure `#000`/`#fff` as dominant surfaces
- Semantic tokens used (not hardcoded per-component colors)
- Dark mode is adapted, not simple inversion

### C) Layout and Spatial Rhythm
- No cards-inside-cards without strong reason
- No repetitive cookie-cutter card blocks
- Consistent spacing rhythm (4pt-style cadence)
- Uses `gap`/layout primitives cleanly

### D) Motion and Interaction
- No bounce/elastic gimmick motion for product UI
- Animations use transform/opacity (avoid layout-thrashing)
- Reduced motion support exists
- States exist: hover, focus-visible, active, disabled, loading/error

### E) UX Writing
- Buttons are verb + object (e.g. "Save changes")
- Error copy includes what happened + why + how to fix
- Empty states include guidance + next action
- Consistent terminology

### F) Accessibility Safety Nets
- Keyboard-visible focus treatment (`:focus-visible`)
- Contrast baseline (WCAG AA)
- Touch targets reasonable (44x44 where applicable)

## Phase 3: Severity and Scoring

Group findings by severity:

- **Critical**: accessibility failures, broken interaction states, unreadable contrast
- **Warning**: strong AI fingerprint/slop patterns, inconsistent design system usage
- **Info**: polish/consistency opportunities

Score each category 1-10 and include evidence (`file:line`).

## Phase 4: Output

1. **Result**: PASS / NEEDS WORK
2. **Audited files** (list)
3. **Category scores**
4. **Findings by severity** with actionable fixes
5. **Fast remediation plan** (top 3 fixes first)

If `--full-report` is false, omit empty categories.

## Related Commands

| Need                        | Command      |
| --------------------------- | ------------ |
| Design from scratch         | `/design`    |
| Full UI review              | `/ui-review` |
| Implementation work         | `/ship`      |
