---
description: Audit changed UI files for AI slop patterns and design-system violations
argument-hint: "[path|auto] [--staged] [--since=<ref>] [--full-report]"
agentType: vision
model: proxypal/gemini-3-pro-preview
---

# UI Slop Check: $ARGUMENTS

Run a focused anti-slop audit against changed UI files using the frontend-design taxonomy.

## Load Skills

```typescript
skill({ name: "frontend-design" }); // Anti-pattern taxonomy + design references
skill({ name: "visual-analysis" }); // Structured visual/code analysis workflow
skill({ name: "accessibility-audit" }); // Keyboard/focus/contrast checks
```

## Parse Arguments

| Argument        | Default | Description                                                   |
| --------------- | ------- | ------------------------------------------------------------- |
| `[path\|auto]`  | `auto`  | Specific file/dir to audit, or auto-detect changed UI files   |
| `--staged`      | false   | Audit staged changes only (`git diff --cached`)               |
| `--since=<ref>` | `HEAD`  | Compare against ref (`main`, `HEAD~1`, commit SHA)            |
| `--full-report` | false   | Include all categories even when no issues found              |

## Phase 1: Resolve Target Files

If `[path]` is provided:

- Audit that path directly

If `auto`:

```bash
# unstaged + staged by default
git diff --name-only $SINCE_REF -- \
  '*.tsx' '*.jsx' '*.css' '*.scss' '*.sass' '*.less' '*.html' '*.mdx'
```

If `--staged`:

```bash
git diff --cached --name-only -- \
  '*.tsx' '*.jsx' '*.css' '*.scss' '*.sass' '*.less' '*.html' '*.mdx'
```

Prioritize files under:

- `src/components/**`
- `src/app/**`
- `src/pages/**`
- `app/**`
- `components/**`

If no UI files changed, return: **PASS (no changed UI files)**.

## Phase 2: Run AI Slop Checklist

Evaluate each target file (or rendered screenshot if provided) against these checks.

### A) Typography

- Banned default aesthetics (Inter/Roboto/Arial/Open Sans as dominant display voice)
- Body text uses `rem/em`, not fixed `px`
- Clear hierarchy (size/weight/spacing), not color-only hierarchy
- Body line length near readable measure (around 65ch when applicable)

### B) Color and Theming

- No AI default palette tropes (purple-blue gradient defaults, neon-on-dark clichés)
- No pure `#000` / `#fff` as dominant surfaces
- Gray text is not placed on saturated backgrounds
- Semantic tokens are used (not random per-component hardcoded colors)
- Dark mode is adapted, not simple inversion

### C) Layout and Spatial Rhythm

- No cards-inside-cards without strong information architecture reason
- No repetitive cookie-cutter card blocks with identical structure
- Spacing rhythm is consistent (4pt-style cadence), not arbitrary jumps
- Uses `gap`/layout primitives cleanly; avoids margin hacks when possible

### D) Motion and Interaction

- No bounce/elastic gimmick motion for product UI
- Animations use transform/opacity (avoid layout-thrashing properties)
- Reduced motion support exists for meaningful motion
- States exist: hover, focus-visible, active, disabled, loading/error where relevant

### E) UX Writing

- Buttons are verb + object (e.g. "Save changes")
- Error copy includes what happened + why + how to fix
- Empty states include guidance + next action
- Terminology is consistent (avoid mixed synonyms for same action)

### F) Accessibility Safety Nets

- Keyboard-visible focus treatment (`:focus-visible`)
- Contrast baseline expectations (WCAG AA)
- Touch targets reasonable (44x44 context where applicable)

## Phase 3: Severity and Scoring

Group findings by severity:

- **Critical**: accessibility failures, broken interaction states, unreadable contrast
- **Warning**: strong AI fingerprint/slop patterns, inconsistent design system usage
- **Info**: polish/consistency opportunities

Score each category 1-10 and include evidence (`file:line` for code audits).

## Phase 4: Output

Return:

1. **Result**: PASS / NEEDS WORK
2. **Audited files** (list)
3. **Category scores**
4. **Findings by severity** with actionable fixes
5. **Fast remediation plan** (top 3 fixes first)

If `--full-report` is false, omit empty categories.

## Record Findings

```typescript
observation({
  type: "warning",
  title: "UI Slop Check: [scope]",
  narrative: "Detected [count] critical, [count] warning slop issues in changed UI files.",
  concepts: "ui, design, anti-patterns, frontend",
  confidence: "high",
});
```

## Related Commands

| Need                                     | Command      |
| ---------------------------------------- | ------------ |
| Design from scratch                      | `/design`    |
| Full UI review (single screen/component) | `/ui-review` |
| Implementation work                      | `/ship`      |
