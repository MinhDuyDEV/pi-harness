---
name: frontend-design
description: MUST load when building any web UI with React-based frameworks — components, pages, or full applications. Covers Tailwind CSS v4, shadcn/ui, Motion animations. Base UI implementation skill; combine with aesthetic overlays (minimalist-ui, high-end-visual-design) for specific styles.
version: 1.1.0
tags: [ui, design]
dependencies: []
---

# Frontend Design

## When to Use

- Building UI with React frameworks (Next.js, Vite, Remix)
- Creating visually distinctive, memorable interfaces
- Implementing accessible components with shadcn/ui
- Styling with Tailwind CSS v4
- Adding animations and micro-interactions
- Creating visual designs, posters, brand materials

## When NOT to Use

- Backend-only tasks or minimal UI with no visual design requirements.

## Reference Documentation

### Tailwind CSS v4.1

- `./references/tailwind/v4-config.md` - Installation, @theme, CSS-first config
- `./references/tailwind/v4-features.md` - Container queries, gradients, masks, text shadows
- `./references/tailwind/utilities-layout.md` - Display, flex, grid, position
- `./references/tailwind/utilities-styling.md` - Spacing, typography, colors, borders
- `./references/tailwind/responsive.md` - Breakpoints, mobile-first, container queries

Search: `@theme`, `@container`, `OKLCH`, `mask-`, `text-shadow`

### shadcn/ui (CLI v3.6)

- `./references/shadcn/setup.md` - Installation, visual styles, component list
- `./references/shadcn/core-components.md` - Button, Card, Dialog, Select, Tabs, Toast
- `./references/shadcn/form-components.md` - Form, Field, Input Group, 2026 components
- `./references/shadcn/theming.md` - CSS variables, OKLCH, dark mode
- `./references/shadcn/accessibility.md` - ARIA, keyboard, screen reader

Search: `Field`, `InputGroup`, `Spinner`, `ButtonGroup`, `next-themes`

### Animation (Motion + Tailwind)

- `./references/animation/motion-core.md` - Timing system, easing constants, performance rules, reduced motion, core patterns
- `./references/animation/motion-advanced.md` - AnimatePresence, scroll, orchestration, TypeScript

**Stack**:
| Animation Type | Tool |
|----------------|------|
| Hover/transitions | Tailwind CSS (`transition-*`) |
| shadcn states | `tailwindcss-animate` (built-in) |
| Gestures/layout/exit | Motion (`motion/react`) |
| Complex SVG morphing | anime.js v4 (niche only) |

### Visual Design

- `./references/canvas/philosophy.md` - Design movements, core principles
- `./references/canvas/execution.md` - Multi-page systems, quality standards

For sophisticated compositions: posters, brand materials, design systems.

### Design Systems (Deep Guides)

- `./references/design/color-system.md` - OKLCH, semantic tokens, dark mode architecture
- `./references/design/typography-rules.md` - Fluid type, modular scale, OpenType features
- `./references/design/interaction.md` - State models, focus, dialogs/popovers, loading patterns
- `./references/design/ux-writing.md` - Button copy, error structure, empty states, i18n

Search: `AI Slop Test`, `tinted neutrals`, `focus-visible`, `verb + object`, `65ch`

## Design Thinking

Before coding, commit to BOLD aesthetic direction:

- **Purpose**: What problem? Who uses it?
- **Tone**: Pick extreme - brutally minimal, maximalist chaos, retro-futuristic, organic, luxury, playful, editorial, brutalist, art deco, soft/pastel, industrial
- **Differentiation**: What makes this UNFORGETTABLE?

Bold maximalism and refined minimalism both work. Key is intentionality.

## Anti-Patterns (AI Fingerprints — NEVER)

These patterns immediately signal "AI made this." Avoid them all.

### Typography

- **Banned fonts**: Inter, Roboto, Arial, Open Sans, Lato, Montserrat, Space Grotesk, system-ui as display font
- Monospace used as "developer aesthetic" shorthand
- Big icons centered above every heading
- Using `px` for body text (use `rem`/`em` to respect user settings)

### Color

- **AI palette**: Cyan-on-dark, purple-to-blue gradients, neon accents on dark backgrounds
- Gray text on colored backgrounds (use darker shade of background color instead)
- Pure `#000` or `#fff` (always tint — pure black/white don't exist in nature)
- Gradient text on headings or metrics
- `rgba()` / heavy alpha transparency as primary palette (design smell — define explicit colors)

### Layout

- Cards nested inside cards (use typography, spacing, dividers for hierarchy within a card)
- Identical card grids (icon + heading + text repeated 3-6 times)
- Hero metric template (big number + small label + gradient accent)
- Center-aligning everything
- Same spacing everywhere (no visual rhythm)

### Visual

- Glassmorphism used decoratively (blur cards, glow borders)
- Thick colored border on one side of rounded rectangles
- Sparklines as decoration (not connected to real data)
- Generic drop shadows on everything
- Rounded rectangles as the only shape language

### Motion

- Bounce or elastic easing (real objects decelerate smoothly)
- Animating `height`, `width`, `padding`, `margin` (causes layout recalculation)
- Default `ease` (compromise that's rarely optimal — use exponential easing)
- Missing `prefers-reduced-motion` handling

> **The AI Slop Test**: If you showed this interface to someone and said "AI made this," would they believe you immediately? If yes, that's the problem.

## Best Practices

1. **Accessibility First**: Radix primitives, `:focus-visible` (not `:focus`), semantic HTML, 44px touch targets
2. **Mobile-First**: Start mobile, layer responsive variants with `min-width` queries
3. **Design Tokens**: Two-layer system — primitives (`--blue-500`) + semantic (`--color-primary: var(--blue-500)`); dark mode redefines semantic layer only
4. **Dark Mode**: Not inverted light mode — lighter surfaces create depth (no shadows); desaturate accents; base at `oklch(15-18% …)`
5. **Container Queries**: Use `@container` for component layout, viewport queries for page layout
6. **Performance**: `transform` + `opacity` only for animations; CSS purging; avoid dynamic class names
7. **TypeScript**: Full type safety
8. **Expert Craftsmanship**: Every detail matters — squint test for hierarchy validation

## Core Stack Summary

**Tailwind v4.1**: CSS-first config via `@theme`. Single `@import "tailwindcss"`. OKLCH colors. Container queries built-in.

**shadcn/ui v3.6**: Copy-paste Radix components. Visual styles: Vega/Nova/Maia/Lyra/Mira. New: Field, InputGroup, Spinner, ButtonGroup.

**Motion**: `import { motion, AnimatePresence } from 'motion/react'`. Declarative React animations. Use `tailwindcss-animate` for shadcn states.

## Typography

→ Consult `./references/design/typography-rules.md` for full fluid type system

Choose distinctive fonts. Pair display with body:

- **Preferred**: Instrument Sans, Plus Jakarta Sans, Outfit, Onest, Figtree, Urbanist (sans); Fraunces, Newsreader (editorial)
- **Fluid sizing**: `clamp(1rem, 0.5rem + 2vw, 1.5rem)` — never fixed `px` for body
- **Modular scale**: Pick one ratio (1.25 major third, 1.333 perfect fourth) — 5 sizes max
- **Measure**: `max-width: 65ch` for body text
- **OpenType**: `tabular-nums` for data, `diagonal-fractions` for recipes, `all-small-caps` for abbreviations

```css
@theme {
  --font-display: "Fraunces", serif;
  --font-body: "Instrument Sans", sans-serif;
}
```

## Color

→ Consult `./references/design/color-system.md` for OKLCH deep guide

Use OKLCH for perceptually uniform colors. Two-layer token system:

```css
@theme {
  /* Primitives */
  --blue-500: oklch(0.55 0.22 264);
  --amber-400: oklch(0.75 0.18 80);
  /* Semantic (redefine these for dark mode) */
  --color-primary: var(--blue-500);
  --color-accent: var(--amber-400);
  /* Tinted neutrals — chroma 0.01 for subconscious brand cohesion */
  --color-surface: oklch(0.97 0.01 264);
  --color-surface-dark: oklch(0.16 0.01 264);
}
```

## Motion

→ Consult `./references/animation/motion-core.md` for Motion API

**Timing**: 100-150ms instant feedback | 200-300ms state changes | 300-500ms layout | exit = 75% of enter

**Easing**: Exponential only — `cubic-bezier(0.16, 1, 0.3, 1)` for entrances. Never `ease`, never bounce/elastic.

**Performance**: Only animate `transform` and `opacity`. Height expand → `grid-template-rows: 0fr → 1fr`.

**Accessibility**: `prefers-reduced-motion` is mandatory (affects ~35% of adults over 40). Swap spatial animations for crossfades.

```tsx
import { motion, AnimatePresence } from 'motion/react';

<motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} />

<AnimatePresence>
  {show && <motion.div exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />}
</AnimatePresence>
```

CSS stagger: `animation-delay: calc(var(--i, 0) * 50ms)` — cap total at 500ms.

## Spatial Composition

- **4pt spacing system**: 4, 8, 12, 16, 24, 32, 48, 64, 96px — not 8pt (too coarse at small gaps)
- **`gap` over margins** for sibling spacing (eliminates margin collapse)
- **Self-adjusting grids**: `repeat(auto-fit, minmax(280px, 1fr))` — responsive without breakpoints
- **Container queries** for components: `container-type: inline-size` on wrapper, `@container` on children
- **Optical text alignment**: `margin-left: -0.05em` for text that appears indented due to letterform whitespace
- Asymmetry, overlap, diagonal flow, grid-breaking elements. Generous negative space OR controlled density.

## Interaction

→ Consult `./references/design/interaction.md`

Design all 8 states: Default, Hover, Focus, Active, Disabled, Loading, Error, Success. Use `:focus-visible` not `:focus`. Native `<dialog>` + `inert` for modals. Popover API for tooltips/dropdowns. Skeleton screens over spinners. Undo over confirmation dialogs.

## UX Writing

→ Consult `./references/design/ux-writing.md`

Button labels: specific verb + object ("Save changes" not "OK"). Error formula: What happened + Why + How to fix. Empty states are onboarding opportunities. Plan for 30% text expansion (i18n).

## Backgrounds

Create atmosphere: gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, grain overlays.
