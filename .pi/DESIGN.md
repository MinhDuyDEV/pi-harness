# DESIGN.md

Design contract for Pi agent UX and UI review. Use this file as the local visual-quality source of truth for design agents and frontend/UI work.

Inspired by the DESIGN.md pattern documented by Google Stitch and catalogued by VoltAgent's `awesome-design-md`: a plain-text design system that tells agents how a project should look and feel.

## 1. Visual Theme & Atmosphere

- **Mood**: precise, developer-native, calm, and high-signal.
- **Aesthetic**: modern CLI/workbench clarity rather than glossy SaaS marketing.
- **Density**: information-dense but not cramped; prioritize scannability and fast decisions.
- **Personality**: direct, technical, deliberate. Avoid cheerleading, cartoonish decoration, and generic AI-dashboard tropes.
- **Primary impression**: a serious tool for builders coordinating agents, code, tasks, and verification.

## 2. Color Palette & Roles

Use semantic roles instead of arbitrary one-off colors.

| Role | Use |
| --- | --- |
| Background | Main app or document canvas; neutral and quiet |
| Surface | Cards, panels, command areas, and grouped content |
| Surface Raised | Active panels, popovers, modals, selected panes |
| Border | Low-contrast separators and panel outlines |
| Text Primary | Main readable content |
| Text Secondary | Metadata, descriptions, helper text |
| Accent | One primary action/accent color per view |
| Success | Passed checks, completed tasks, safe state |
| Warning | Risk, partial completion, needs attention |
| Danger | Failed checks, destructive actions, security issues |
| Code | Inline code, file paths, command names |

Guardrails:

- One accent color per screen unless status semantics require otherwise.
- Do not use saturated purple/blue gradients as a default AI aesthetic.
- Ensure status colors remain legible on both dark and light surfaces.
- Never rely on color alone for state; pair with text, shape, or iconography.

## 3. Typography Rules

- **Default posture**: crisp sans-serif for UI, monospace for code, paths, commands, and agent/tool output.
- **Hierarchy**: use size, weight, and spacing before decorative effects.
- **Line length**: keep dense prose readable; avoid full-width paragraphs on large screens.
- **Labels**: concise, sentence case, action-oriented.
- **Numbers and statuses**: align for quick scanning in tables, task boards, and diagnostics.

Recommended hierarchy:

| Element | Treatment |
| --- | --- |
| Page title | Strong weight, tight tracking, clear top-level intent |
| Section heading | Medium/semibold, compact spacing |
| Body | High contrast, comfortable line height |
| Metadata | Smaller, muted, never critical-only |
| Code/path | Monospace, visually distinct, no decorative backplate unless needed |

## 4. Component Stylings

### Buttons

- Primary actions should be visually singular and obvious.
- Secondary actions should be quieter, not competing with primary actions.
- Destructive actions require explicit danger styling and confirmation copy.
- Disabled states must explain or imply why the action is unavailable.

### Cards and Panels

- Use panels to group decisions, evidence, tasks, and artifacts.
- Avoid decorative cards with no functional grouping.
- Prefer clear headers, compact metadata, and visible status affordances.

### Inputs and Command Areas

- Optimize for keyboard-first workflows.
- Focus states must be visible without relying on glow effects.
- Error states should include concrete recovery text.

### Tables and Lists

- Use tables for comparable structured data; use lists for findings and decisions.
- Keep row density high but readable.
- Align status, owner, file path, and verification columns consistently.

### Navigation

- Navigation should expose current location and task state.
- Avoid hidden critical controls behind ambiguous icons.

## 5. Layout Principles

- Use structured workbench layouts: sidebar + main pane, split panes, task boards, diff/evidence panels.
- Prefer asymmetry and hierarchy over default centered hero sections.
- Keep high-frequency actions close to the relevant content.
- Preserve whitespace around decision points; dense content still needs breathing room.
- For dashboards, group by workflow stage: perceive, create, verify, ship.

Spacing guidance:

- Use a consistent 4px/8px-derived spacing rhythm.
- Prefer fewer spacing sizes used consistently over many bespoke gaps.
- Avoid uneven margins, accidental center alignment, and unrelated blocks touching.

## 6. Depth & Elevation

- Use subtle borders and surface contrast before shadows.
- Shadows should indicate real layering: popover, modal, floating command palette.
- Avoid glow-heavy neon depth unless explicitly requested.
- Raised elements must have a functional reason.

## 7. Do's and Don'ts

Do:

- Make state, ownership, verification, and blockers visible.
- Use file paths, command names, and evidence as first-class UI content.
- Design for keyboard users and screen-reader compatibility.
- Make empty, loading, error, partial, and success states feel intentional.
- Preserve a serious builder-tool tone.

Don't:

- Use generic startup dashboards, fake metrics, fake testimonials, or placeholder names.
- Default to centered hero + three cards for product UI.
- Add emojis, confetti, neon gradients, glassmorphism, or gratuitous motion.
- Hide verification failures or destructive operations behind low-contrast UI.
- Invent brand tokens not represented in the implementation.

## 8. Responsive Behavior

- Desktop: support split-pane and dense workbench views.
- Tablet: collapse secondary panes into tabs or drawers while preserving task context.
- Mobile: prioritize current task, status, and next action; defer dense comparison tables.
- Touch targets should be at least 44px where interaction is touch-first.
- Do not remove critical verification or safety information on smaller screens.

## 9. Agent Prompt Guide

When reviewing UI/UX, the vision agent should:

1. Read this file first when present.
2. Compare the UI against the design contract before applying generic taste rules.
3. Report mismatches by contract section: theme, color, typography, components, layout, depth, responsive behavior, and guardrails.
4. Separate `DESIGN.md` violations from accessibility defects and general UX risks.
5. Recommend concrete token/component/layout/state changes, not vague polish.
6. Cite unverifiable items explicitly when screenshots or code do not expose enough evidence.

Recommended review phrasing:

- "This violates DESIGN.md §4 Buttons because the primary and secondary actions compete visually."
- "This matches DESIGN.md §5 Layout: workbench-style split pane with task context visible."
- "Accessibility risk: focus state is not visible from the screenshot; verify keyboard focus styling."
