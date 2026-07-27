---
name: figma
description: >-
  Fetches layout, styles, and image assets from Figma files through the Figma REST API and maps
  them to design-system tokens. User-invoked: load via /skill:figma when implementing UI from a
  shared Figma URL, extracting design tokens, or downloading assets. Requires a FIGMA_API_KEY
  token.
metadata:
  version: 1.0.0
  tags:
  - design
  - integration
  dependencies: []
disable-model-invocation: true
---

# Figma Design Data (REST API)

## When to Use

Fetching layout, styles, or assets from a Figma file via the Figma REST API. Load when the user shares a Figma URL or references a Figma file.

## When NOT to Use

No Figma file key / node ID available; design data not required for the task.

## Prerequisites

```bash
export FIGMA_API_KEY="<figma-token>"
```

Token: Figma → Account Settings → Personal Access Tokens. Scope: `File read` (and `Dev resources` for assets).

## Core Workflow

1. **Parse the URL.** Extract `file_key` and optional `node_id` from the Figma URL.
2. **Fetch the node data.** `GET /v1/files/{file_key}/nodes?ids={node_id}` for layout, styles, text.
3. **Fetch assets if needed.** `GET /v1/images/{file_key}?ids=...` for image exports (PNG, SVG, PDF).
4. **Extract tokens.** Build a token map: colors, typography, spacing from the file.
5. **Map to design system.** Convert Figma styles to your design tokens (see `design-taste-frontend`).
6. **Implement.** Use the tokens, not the raw Figma values.

## Common Operations

| Operation | When |
|---|---|
| Get file metadata | First step in any flow |
| Get specific node | When you have a node ID from a URL |
| Get image exports | When you need assets (icons, illustrations) |
| Get styles / variables | Token extraction |

## Token Extraction

```ts
// Pseudo-pattern for extracting tokens
const tokens = {
  colors: extractColors(styles),
  typography: extractTypography(textStyles),
  spacing: extractSpacing(effects) // sometimes inferred from layout
}
```

Map to your design system (e.g., CSS variables, Tailwind config, design tokens package). Don't hardcode Figma values.

## Red Flags

API key in code or logs; not setting `FIGMA_API_KEY` first; fetching the whole file when one node is needed (token waste, and repeated fetches hit the 60 requests/min rate limit → 429); hardcoding Figma values instead of extracted tokens; manually transcribing design values (error-prone, stale); no cache of extracted data (re-fetching every run); unhandled 404 (file moved or private); wrong node ID format; full-res downloads when a thumbnail would do; using stale data after the design changed; assuming the token is public (it's not — it needs scope).
