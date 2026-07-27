---
name: mockup-to-code
description: >-
  Converts visual designs (Figma, Sketch, screenshots, wireframes) into production code via token
  extraction, ordered component builds, and screenshot validation. User-invoked: load via
  /skill:mockup-to-code when implementing a UI from a mockup or building a component library from a
  design system.
metadata:
  version: 1.0.0
  tags:
  - ui
  - workflow
  dependencies: []
disable-model-invocation: true
---

# Mockup to Code

## When to Use

You have a visual design (Figma, Sketch, screenshot, wireframe, hand-drawn mockup) and need to implement it in code. The design exists as pixels, the code must match.

## Core Principle

**The design is the spec.** If the code doesn't match the design, the code is wrong. "Close enough" is a design debt.

## Workflow

1. **Audit the design.** What components exist? What states? What tokens? Screenshot every state.
2. **Set up tokens.** Colors, typography, spacing, radius — extract from the design. No magic numbers.
3. **Build the components.** One at a time, in isolation. Button → Input → Card → Layout.
4. **Compose the page.** Components into sections, sections into pages.
5. **Validate against the design.** Pixel-precision on spacing, type, color. Screenshot and compare.
6. **Iterate.** Design feedback → adjust → re-validate.

## Token Extraction

Map the visual design to a design system:
- Colors → `--color-*` CSS variables or theme tokens
- Typography → font family, size, weight, line-height
- Spacing → smallest unit in the design (often 4px or 8px)
- Radius → button, card, input radii
- Shadows → depth levels (elevation, modal, tooltip)

"Magic numbers" in the implementation mean the token is missing.

## Component Order

Build in this order:
1. **Typography** (headings, body, labels — the base layer)
2. **Color tokens** (background, text, border, accent)
3. **Layout primitives** (Container, Stack, Grid)
4. **Atomic components** (Button, Input, Tag, Badge)
5. **Composite components** (Card, Modal, Form, Table)
6. **Page sections** (Header, Hero, Sidebar, Footer)
7. **Full page** (compose the sections)

Each step validates the previous.

## Validation

Compare implementation against the design, in increasing rigor:

1. **Overlay** — screenshot the implementation, overlay the design export at ~50% opacity, inspect offsets.
2. **Automated** — Playwright screenshot comparison (`toHaveScreenshot()`) against the design export.
3. **Manual** — designer inspects the implementation side by side with the design.

If the designer can't tell the difference, it's done. If they can, fix the gap.

## When the Design Is Incomplete

- Missing states (hover, error, loading, empty): ask or define based on the system.
- Missing responsive: ask or define for mobile first.
- Missing tokens: extract from the design, or ask.
- Missing dark mode: ask or ship light only.

Document the decisions. "Assumed hover state based on spec for button."

## Red Flags

Magic numbers (the token is missing); "close enough" (the design is the spec — a visible gap is design debt); missing states (no hover, no error, no loading, no empty); "I'll add responsive later" (mobile-first now); "I'll fix the tokens later" (tokens first); wrong component order (carousel before typography); no validation step; building from memory instead of the open design; "designer says it's fine" (ask specifically); design and code silently diverging.
