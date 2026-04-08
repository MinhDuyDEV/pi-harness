---
name: visual-analysis
description: Use when analyzing images, screenshots, UI mockups, or visual content for extracting information, comparing designs, or assessing visual properties like colors, typography, and layout
version: 1.0.0
tags: [design, research]
dependencies: []
---

# Visual Analysis Skill

> **Replaces** guessing at visual properties from code alone — direct inspection of rendered output for colors, layout, spacing, and typography

## When to Use

- Analyzing UI mockups or screenshots
- Extracting information from images
- Comparing visual designs
- Quick visual assessments

## When NOT to Use

- Pure text/code review without any visual assets.

## Workflow

1. **Capture** — Get the image (screenshot, mockup, or user-provided)
2. **Analyze** — Use vision agent to extract specific properties (colors as hex, font sizes, spacing in px/rem)
3. **Compare** — Cross-reference extracted values against design tokens and existing CSS
4. **Report** — List discrepancies with specific values and file locations

## Quick Mode

Fast, focused analysis for specific questions.

**Prompt pattern:**

```
Analyze this image: [attach image]
[specific question]
```

**Examples:**

- "What text is visible in this UI?"
- "List all colors used with their hex values"
- "Identify all interactive elements"

## Deep Mode

Comprehensive analysis with structured output.

**Prompt pattern:**

```
Analyze this image comprehensively:

1. CONTENT INVENTORY
   - All UI elements present
   - Text content
   - Icons and imagery

2. VISUAL PROPERTIES
   - Color palette (hex values)
   - Typography (fonts, sizes, weights)
   - Spacing patterns
   - Layout structure

3. OBSERVATIONS
   - Design patterns used
   - Potential issues
   - Notable features

Output as structured markdown.
```

## Common Analysis Patterns

### UI Component Analysis

```
Analyze this UI component:

1. Component type and purpose
2. Visual states (hover, focus, disabled)
3. Accessibility considerations
4. Props/variants needed
5. Similar patterns in common UI libraries
```

### Screenshot Comparison

```
Compare these two images:

1. Visual differences (be specific about location)
2. Missing elements
3. Spacing/sizing discrepancies
4. Color accuracy
5. Priority fixes ranked by visual impact
```

### Color Extraction

```
Extract all colors from this image.

Output as JSON:
{
  "primary": ["#hex1", "#hex2"],
  "secondary": ["#hex3"],
  "neutral": ["#hex4", "#hex5"],
  "accent": ["#hex6"]
}

Include approximate usage percentage for each color.
```

### Layout Analysis

```
Analyze the layout structure:

1. Grid system (columns, gutters)
2. Container widths
3. Section divisions
4. Responsive breakpoint hints
5. Flexbox vs Grid recommendations

Output CSS/Tailwind structure.
```

## Output Formats

- **Markdown** (default): Structured text
- **JSON**: For design tokens
- **Code**: Direct implementation

## Storage

Save findings to `.opencode/memory/design/analysis/`

## Anti-Patterns

| Anti-Pattern                                                                   | Why It Fails                                                                 | Instead                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Describing layout vaguely ("looks good") instead of extracting specific values | Feedback is non-actionable and hard to validate                              | Report measurable values (hex, px/rem, font size/weight) with locations     |
| Not comparing against existing design tokens                                   | Findings drift from system standards and create inconsistent recommendations | Map extracted values to tokens first, then flag true mismatches             |
| Analyzing low-resolution screenshots (artifacts mislead analysis)              | Compression/noise causes false readings for spacing and color                | Request higher-resolution captures or zoomed crops before final conclusions |

## See Also

- `mockup-to-code`
- `design-system-audit`
- `accessibility-audit`
