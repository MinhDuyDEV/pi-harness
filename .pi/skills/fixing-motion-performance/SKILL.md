---
name: fixing-motion-performance
description: Fixes animation jank — compositor-only properties, layout-thrash batching, scroll-linked motion, blur cost —
  with tiered fix priorities and code fixes. User-invoked; load via /skill:fixing-motion-performance when animations stutter,
  scrolling is janky, or an animation-heavy change needs review.
metadata:
  version: 1.0.0
  tags:
  - ui
  - performance
  dependencies: []
disable-model-invocation: true
---

# Fixing Motion Performance

Diagnoses and fixes animation performance. Two usages: apply these constraints to all animation work in the session, or review a named file and report violations with fixes.

## Rendering Glossary

| Step | Triggered by | Cost |
|---|---|---|
| Layout | width, height, top/left, margin, padding, flex/grid, font-size | highest — cascades to descendants, main thread |
| Paint | color, background, border-radius, box-shadow, filter, mask | medium |
| Composite | transform, opacity | cheapest — GPU, off main thread |

## The Rule

**Animate compositor properties only: `transform` and `opacity`.** Paint or layout animation is acceptable solely on small, isolated surfaces.

## Fix Priority

1. **Never patterns (critical)** — do not interleave layout reads and writes in the same frame; never drive animation from scroll events, `scrollTop`, or `scrollY`; no rAF loops without a stop condition; no continuous layout animation on large surfaces; don't mix multiple animation systems measuring and mutating the same layout.
2. **Mechanism (critical)** — default to CSS transitions/animations or WAAPI; JS-driven animation only for interaction-driven effects (drag, physics).
3. **Measurement (high)** — batch DOM reads (`getBoundingClientRect`, `offsetWidth`, `scrollTop`) before writes; cache measurements outside loops.
4. **Scroll (high)** — scroll-linked motion via CSS `animation-timeline: scroll()`, or `IntersectionObserver` toggling a class; parallax via `transform`, never top/margin.
5. **Paint (medium-high)** — isolate repaint areas with `contain: paint`; don't animate box-shadow — animate the opacity of a pre-rendered shadow layer.
6. **Layers (medium)** — `will-change` only while animating, removed after; excess layers cost memory and compositing time.
7. **Blur/filters (medium)** — animating `filter: blur()` repaints every frame; cross-fade two pre-blurred layers with opacity instead.

## Common Fixes

Layout animation → transform:

```css
/* BAD: width animates layout every frame */
.panel { transition: width 300ms; }
/* GOOD: compositor only */
.panel { transition: transform 300ms; transform: scaleX(0.5); transform-origin: left; }
```

Layout thrash → batch reads, then writes:

```js
// BAD: read-write interleaved forces sync layout each iteration
items.forEach((el) => { el.style.width = el.offsetWidth / 2 + "px"; });
// GOOD: all reads first, then all writes
const widths = items.map((el) => el.offsetWidth);
items.forEach((el, i) => { el.style.width = widths[i] / 2 + "px"; });
```

Scroll-driven JS → declarative: replace the scroll listener + style writes with `animation-timeline: scroll()`, or an IntersectionObserver toggling a class that animates transform.

## Review Mode Output

For each violation: file:line, tier, the rendering step it triggers, and the concrete fix. Order by tier. Verify in the DevTools Performance panel: no layout (purple) spikes during animation, no long tasks, steady frame rate — with CPU throttling on, not just on a fast machine.

## Red Flags

`transition: all`; animating width, height, top, left, or margin; a scroll handler mutating styles on every event; `will-change` left on permanently; `offsetWidth` read inside a write loop; blur radius animated on a large surface; "smooth on my machine" without a throttled-CPU check.
