---
name: figma-go
description: Live Figma integration via plugin bridge (no API key, no rate limits). Full read/write access to open Figma files — inspect designs, extract tokens, create/modify nodes, export screenshots. Requires Figma Desktop with the figma-mcp-go plugin running.
version: 1.0.0
tags: [design, mcp, integration, figma]
dependencies: []
---

# Figma Live (figma-mcp-go)

Zero-config, unlimited Figma access through a local plugin bridge. Unlike the REST API-based `figma` skill, this connects directly to your open Figma file via a WebSocket bridge — no API key, no rate limits, full read + write.

## When to Use

- Inspecting live Figma designs to implement UI
- Extracting design tokens (colors, typography, spacing, variables)
- Creating or modifying Figma nodes programmatically
- Exporting screenshots/assets from the canvas
- Searching for components, text, or specific node types
- Batch operations on designs (rename, move, resize)

## When NOT to Use

- Figma Desktop is not open (use the REST API `figma` skill instead)
- You need to access files not currently open in Figma
- You only have a Figma URL but no Desktop session

## Prerequisites

### 1. Install the Figma Plugin

1. Download `plugin.zip` from the [latest release](https://github.com/vkhanhqui/figma-mcp-go/releases)
2. Extract it
3. In **Figma Desktop**: Plugins → Development → Import plugin from manifest
4. Point to the extracted `manifest.json`

### 2. Run the Plugin

1. Open a Figma file in **Figma Desktop**
2. Run the plugin: Plugins → Development → figma-mcp-go
3. The plugin UI shows a green "Connected" badge when the bridge is active

> **Note**: The plugin requires Figma Desktop (not browser) because it uses a localhost WebSocket (`ws://localhost:1994`).

## Quick Start

After loading with `/skill:figma-go`:

```
# Get an overview of the current file
get_metadata()

# See what's selected on canvas
get_selection()

# Get the full page structure (use depth/detail to control size)
get_design_context({ "depth": 2, "detail": "compact" })

# Search for specific nodes
search_nodes({ "query": "Button", "types": ["COMPONENT", "INSTANCE"] })
```

## Available Tools

### Document & Navigation

| Tool | Key Params | Description |
|---|---|---|
| `get_document` | — | Full current page node tree |
| `get_metadata` | — | File name, pages, current page info |
| `get_pages` | — | Lightweight page list (IDs + names) |
| `get_selection` | — | Currently selected nodes on canvas |
| `get_node` | `nodeId` | Single node by ID |
| `get_nodes_info` | `nodeIds[]` | Batch fetch multiple nodes |
| `get_design_context` | `depth`, `detail` | Depth-limited tree. `detail`: `minimal` (5% tokens) / `compact` (30%) / `full` (100%) |
| `get_viewport` | — | Viewport center, zoom, visible bounds |

### Search & Scan

| Tool | Key Params | Description |
|---|---|---|
| `search_nodes` | `query`, `nodeId`, `types[]`, `limit` | Find nodes by name + optional type filter (scope to subtree via `nodeId`) |
| `scan_text_nodes` | `nodeId` | All TEXT nodes in subtree with style info |
| `scan_nodes_by_types` | `nodeId`, `types[]` | Nodes matching type list (FRAME, COMPONENT, INSTANCE, etc.) |

### Styles, Variables & Components

| Tool | Key Params | Description |
|---|---|---|
| `get_styles` | — | Paint, text, effect, grid local styles |
| `get_variable_defs` | — | Variable collections, modes, values (design tokens) |
| `get_local_components` | — | Components, component sets, variant properties |
| `get_fonts` | — | All fonts used on current page, sorted by frequency |
| `get_annotations` | `nodeId` (opt) | Dev-mode annotations |
| `get_reactions` | `nodeId` | Prototype interactions/reactions on a node |

### Export

| Tool | Key Params | Description |
|---|---|---|
| `get_screenshot` | `nodeIds[]`, `format`, `scale` | Export as base64 (PNG/SVG/JPG/PDF, default scale 2×) |
| `save_screenshots` | `items[]`, `format`, `scale` | Batch export to local filesystem. Paths must be relative to working directory (absolute paths rejected). |

### Create Nodes

| Tool | Key Params | Description |
|---|---|---|
| `create_frame` | `x`, `y`, `width`, `height`, `name`, `fillColor`, `layoutMode`, `padding*`, `itemSpacing`, `parentId` | Frame with optional auto-layout |
| `create_rectangle` | `x`, `y`, `width`, `height`, `name`, `fillColor`, `cornerRadius`, `parentId` | Rectangle |
| `create_ellipse` | `x`, `y`, `width`, `height`, `name`, `fillColor`, `parentId` | Ellipse/circle |
| `create_text` | `text`, `x`, `y`, `fontSize`, `fontFamily`, `fontStyle`, `fillColor`, `parentId` | Text node (font loaded automatically) |
| `import_image` | `imageData` (base64), `x`, `y`, `width`, `height`, `scaleMode`, `parentId` | Image from base64 PNG/JPG |

### Modify Nodes

| Tool | Key Params | Description |
|---|---|---|
| `set_text` | `nodeId`, `text` | Update text content |
| `set_fills` | `nodeId`, `color` (hex), `opacity` | Set solid fill color |
| `set_strokes` | `nodeId`, `color` (hex), `strokeWeight` | Set stroke color + weight |
| `move_nodes` | `nodeIds[]`, `x`, `y` | Move to absolute position |
| `resize_nodes` | `nodeIds[]`, `width`, `height` | Resize nodes |
| `rename_node` | `nodeId`, `name` | Rename a node |
| `clone_node` | `nodeId`, `x`, `y`, `parentId` | Clone with optional repositioning |

### Delete

| Tool | Key Params | Description |
|---|---|---|
| `delete_nodes` | `nodeIds[]` | Permanently delete nodes (**not undoable via MCP** — Ctrl+Z in Figma Desktop only) |

## Workflows

### Inspect a Design for Implementation

```
# 1. Start with what the user has selected
get_selection()

# 2. Get the design context with compact detail
get_design_context({ "depth": 3, "detail": "compact" })

# 3. Extract design tokens
get_styles()
get_variable_defs()

# 4. Get font information
get_fonts()

# 5. Screenshot for visual reference
get_screenshot({ "nodeIds": ["1234:5678"], "format": "PNG", "scale": 2 })
```

### Extract Design Tokens

```
# Variables (colors, spacing, breakpoints defined as Figma variables)
get_variable_defs()

# Styles (paint styles, text styles, effects)
get_styles()

# Components (reusable patterns)
get_local_components()
```

### Find & Update Text Content

```
# 1. Find all text in a section
scan_text_nodes({ "nodeId": "parent-frame-id" })

# 2. Update specific text
set_text({ "nodeId": "text-node-id", "text": "New content" })
```

### Build a Layout Programmatically

```
# 1. Create an auto-layout frame
create_frame({
  "x": 0, "y": 0, "width": 400, "height": 600,
  "name": "Card",
  "layoutMode": "VERTICAL",
  "itemSpacing": 16,
  "paddingTop": 24, "paddingRight": 24,
  "paddingBottom": 24, "paddingLeft": 24,
  "fillColor": "#FFFFFF"
})

# 2. Add text inside it (use the frame's nodeId as parentId)
create_text({
  "text": "Card Title",
  "fontSize": 24,
  "fontFamily": "Inter",
  "fontStyle": "Bold",
  "fillColor": "#1A1A1A",
  "parentId": "frame-node-id"
})
```

### Export Assets

```
# Single screenshot as base64
get_screenshot({ "nodeIds": ["1234:5678"], "format": "SVG" })

# Batch export to local files
save_screenshots({
  "items": [
    { "nodeId": "1234:5678", "outputPath": "./assets/icon-home.svg", "format": "SVG" },
    { "nodeId": "1234:5679", "outputPath": "./assets/hero.png", "format": "PNG", "scale": 2 }
  ]
})
```

### Map Prototype Flows

```
# Get interactions on a screen
get_reactions({ "nodeId": "screen-node-id" })

# Build a flow map: which screens connect to which
# Navigate reactions → NAVIGATE/OPEN_OVERLAY → target node IDs
```

## Design Context Strategy

For large files, use `get_design_context` with appropriate depth and detail:

| Scenario | Recommended | Token Cost |
|---|---|---|
| Quick overview | `depth: 1, detail: "minimal"` | ~5% |
| Component inspection | `depth: 3, detail: "compact"` | ~30% |
| Full implementation reference | `depth: 5, detail: "full"` | ~100% |

**Always start minimal, then drill deeper** on specific nodes with `get_node` or `get_nodes_info`.

## Node ID Format

Figma node IDs use the format `1234:5678`. When searching or referencing:
- Use exact IDs from tool responses
- IDs are page-scoped — switch pages with `get_pages` first if needed

## Architecture

```
Pi Agent ←stdio→ Go Binary ←WebSocket :1994→ Figma Plugin ←Plugin API→ Figma Canvas
```

- The Go binary acts as an MCP server over stdio
- It connects to the Figma plugin via WebSocket on `localhost:1994`
- Multiple AI tools can connect simultaneously (leader/follower pattern)
- All write operations support Ctrl+Z undo in Figma (`figma.commitUndo()`)

## Tips

- **Start with `get_selection`** — the user likely selected what they want you to work with
- **Use `get_design_context` over `get_document`** — it's token-aware with depth/detail controls
- **Batch operations** — `get_nodes_info` and `move_nodes`/`resize_nodes` accept arrays
- **All writes are undoable** — Figma's undo stack works normally
- **Screenshots return base64** — use `save_screenshots` for file output
- **Colors are hex** — `#FF0000` format for fills and strokes

## Troubleshooting

| Issue | Solution |
|---|---|
| "WebSocket not connected" | Make sure the plugin is running in Figma Desktop |
| No response from tools | Check the plugin UI shows green "Connected" badge |
| Tools timeout (30s) | Large operations may need the file to be simpler; try specific nodeIds |
| Can't connect | Ensure port 1994 is free; only one leader process at a time. Port is hardcoded and not configurable. |
| Plugin not found | Import `manifest.json` via Plugins → Development → Import plugin from manifest |
| Browser Figma doesn't work | Must use Figma Desktop — browser blocks localhost WebSocket |

## Comparison with REST API Skill

| Feature | `figma` (Framelink MCP) | `figma-go` (Plugin Bridge) |
|---|---|---|
| Auth | API key required | None |
| Rate limits | Strict (plan-dependent) | Unlimited |
| File access | Any file you have access to | Only currently open file |
| Write access | No | Yes (create, modify, delete) |
| Live selection | No | Yes |
| Works without Desktop | Yes | No |
| Best for | CI/CD, batch processing | Interactive design work |

Use `figma` when you need to access files programmatically without Desktop. Use `figma-go` for interactive design workflows with full read/write power.
