---
description: UI/UX visual design with aesthetic direction and code output
argument-hint: "<component|page|system> [topic] [--quick]"
agentType: vision
---

# Design: $ARGUMENTS

Design a component, page, or design system with a clear aesthetic point of view.

> Optional design track for `/create → /plan → /ship`. Use when visual direction should be decided before or during implementation.

## Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `component` | — | Design a specific component |
| `page` | — | Design a page layout |
| `system` | — | Create or extend a design system |
| `[topic]` | required | What to design, e.g. button or dashboard |
| `--quick` | false | Direction only, no code |

## Load Skills

```typescript
skill({ name: "frontend-design" });
```

## Phase 1: Detect Existing Design System

```typescript
srcwalk_files({ pattern: "**/tailwind.config.{js,ts,mjs}" });
srcwalk_files({ pattern: "**/globals.css" });
srcwalk_files({ pattern: "**/components.json" });
```

Read what exists. Do not design in a vacuum.

## Phase 2: Check Memory

```typescript
memory-search({ query: "[topic] design UI", limit: 3 });
memory-search({ query: "design system colors typography", limit: 3 });
```

Reuse existing aesthetic decisions unless the user asks to change them.

## Phase 3: Design

Before designing, state:

1. **Aesthetic direction** — style and rationale.
2. **Key characteristics** — 3 specific choices.

Output by type:

| Task Type | Output |
| --- | --- |
| `component` | Spec: variants, sizes, states, code if not `--quick` |
| `page` | Layout, sections, responsive behavior |
| `system` | Tokens, CSS variables, usage guidelines |

For `--quick`, provide direction and key decisions only.

## Phase 4: Save Artifact When Relevant

If a matching work directory exists, write `.pi/artifacts/<id>/DESIGN.md`. Otherwise report inline unless the user asks for a file.

## Phase 5: Record Decision

```typescript
observation({
  type: "decision",
  title: "Design: [topic]",
  narrative: "Chose [direction] because [rationale]. Key tokens: [colors, fonts].",
  concepts: "design, ui, [topic]",
  confidence: "high",
});
```

## Examples

```bash
/design component button
/design page landing --quick
/design system
```

## Related Commands

| Need | Command |
| --- | --- |
| Review existing UI | `/ui-review` |
| Implement it | `/ship <id>` |
