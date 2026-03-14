---
description: UI/UX visual design with aesthetic direction and code output
---

# Design: $@

Design a component, page, or design system with a clear aesthetic point of view.

> **Design track (optional):** Not part of the core `/create → /start → /ship` workflow.
> Use when you need visual design guidance before or during implementation.

## Parse Arguments

| Argument    | Default  | Description                                 |
| ----------- | -------- | ------------------------------------------- |
| `component` | —        | Design a specific component                 |
| `page`      | —        | Design a page layout                        |
| `system`    | —        | Create or extend a design system            |
| `[topic]`   | required | What to design (e.g. "button", "dashboard") |
| `--quick`   | false    | High-level direction only, skip code        |

---

## Phase 1: Detect Existing Design System

```bash
find . -name "tailwind.config.*" 2>/dev/null | head -5
find . -name "globals.css" 2>/dev/null | head -5
find . -name "components.json" 2>/dev/null | head -5
```

Read what exists. Don't design in a vacuum — build on the project's current system.

---

## Phase 2: Check Project Notes

Check your project notes for existing design decisions on this topic, and any notes on design system colors or typography. Reuse existing aesthetic decisions. Don't contradict previous design choices unless the user asks.

---

## Phase 3: Design

Apply the following design guidance:

- Aesthetic directions and design philosophy
- Typography and font pairing
- Color systems (OKLCH preferred)
- Animation patterns (Motion + Tailwind)
- Avoid AI slop anti-patterns: generic cards, excessive shadows, hollow icons, over-rounded corners
- shadcn/ui component patterns when applicable
- Tailwind v4 configuration patterns

**Before designing, state:**

1. **Aesthetic direction** — which style and why
2. **Key characteristics** — 3 specific elements you'll apply

Then produce the design:

| Task Type   | Output                                |
| ----------- | ------------------------------------- |
| `component` | Spec (variants, sizes, states) + code |
| `page`      | Layout structure + section breakdown  |
| `system`    | Tokens (CSS variables) + guidelines   |

For `--quick`: Skip code output. Provide direction + key decisions only.

---

## Phase 4: Record Decision

Note your design decisions (aesthetic direction, key tokens: colors, fonts) in your project notes for future reference.

---

## Examples

```bash
/design component button           # Full component design with code
/design page landing --quick       # High-level page direction only
/design system                     # Create/extend design system tokens
```

## Related Commands

| Need               | Command         |
| ------------------ | --------------- |
| Review existing UI | `/ui-review`    |
| Start building     | `/start <bead>` |
| Ship it            | `/ship <bead>`  |
