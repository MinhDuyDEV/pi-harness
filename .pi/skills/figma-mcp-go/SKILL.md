---
name: figma-mcp-go
description: Free Figma MCP with full read/write access via plugin bridge — no API token, no rate limits. Create frames, text, shapes; modify fills, strokes, positions; export screenshots. Works via Figma Desktop plugin on localhost WebSocket.
mcp:
  figma-mcp-go:
    command: npx
    args: ["-y", "@vkhanhqui/figma-mcp-go@latest"]
version: 1.0.0
tags: [design, mcp, figma, integration]
dependencies: []
---

# Figma MCP Go — Free Plugin Bridge

Full read/write Figma access via a local plugin bridge. **No API token. No rate limits.** Unlike the REST API-based `figma` skill, this connects directly to Figma Desktop through a WebSocket plugin — unlimited calls on any plan.

## When to Use

- When you need to **read or write** live Figma documents
- When you want to create/modify designs programmatically (frames, text, shapes, fills, positions)
- When you need to export screenshots or assets from Figma
- When you're on a free/starter Figma plan (REST API has only 6 calls/month)
- When you need to inspect design tokens, variables, components, or styles

## When NOT to Use

- When Figma Desktop is not running or the plugin is not active
- When you only need to read from a Figma URL and have a valid `FIGMA_API_KEY` (use the `figma` skill instead — simpler setup)
- When working with Figma files you don't have open in the desktop app

## Prerequisites

**No API key needed.** Only two things required:

### 1. The MCP server starts automatically when you load this skill

### 2. Install & run the Figma plugin in Figma Desktop

1. Download `plugin.zip` from the [latest GitHub release](https://github.com/vkhanhqui/figma-mcp-go/releases)
2. Extract the zip
3. In Figma Desktop: **Plugins → Development → Import plugin from manifest**
4. Select the `manifest.json` from the extracted folder
5. Open any Figma file and run the plugin — it connects to `ws://localhost:1994/ws`
6. The plugin UI shows connection status (green = connected)

> **Note:** The plugin must be running whenever you use these tools. If you see connection errors, open Figma and re-run the plugin.

## Architecture

```
AI Tool (pi/Claude/Cursor)
    │ stdin/stdout (MCP stdio)
    ▼
Go MCP Server (port 1994)
    │ WebSocket
    ▼
Figma Plugin (in Figma Desktop)
    │ Figma Plugin API
    ▼
Live Figma Document
```

- **Leader/Follower:** Multiple AI tools can share one plugin connection. First process binds port 1994 (leader); others proxy through it.
- **All writes are undoable** in Figma with Cmd/Ctrl+Z.
- **Node IDs** use colon format: `4029:12345` (never hyphens).

## Available Tools (35)

### Read — Document & Selection

| Tool | Description |
|------|-------------|
| `get_document` | Full current page document tree |
| `get_pages` | List all pages (lightweight, no tree) |
| `get_metadata` | File name, pages, current page |
| `get_selection` | Currently selected nodes |
| `get_node` | Single node by ID (`nodeId` required) |
| `get_nodes_info` | Batch fetch multiple nodes (`nodeIds[]` required) |
| `get_design_context` | Depth-limited tree with detail levels: `minimal`/`compact`/`full` (token-efficient) |
| `search_nodes` | Find nodes by name/type in subtree (`query` required) |
| `get_viewport` | Viewport center, zoom, visible bounds |
| `get_reactions` | Prototype/interaction reactions on a node |

### Read — Styles & Variables

| Tool | Description |
|------|-------------|
| `get_styles` | All local paint, text, effect, grid styles |
| `get_variable_defs` | Variable collections and values (design tokens) |
| `get_local_components` | All components + component sets with variants |
| `get_annotations` | Dev-mode annotations |
| `get_fonts` | All fonts on current page, sorted by frequency |

### Read — Scan

| Tool | Description |
|------|-------------|
| `scan_text_nodes` | All text content in a subtree (`nodeId` required) |
| `scan_nodes_by_types` | Nodes matching type list (`nodeId`, `types[]` required) |

### Read — Export

| Tool | Description |
|------|-------------|
| `get_screenshot` | Base64 image export (PNG/SVG/JPG/PDF) of any node |
| `save_screenshots` | Export images directly to disk (batch) |

### Write — Create

| Tool | Description |
|------|-------------|
| `create_frame` | Frame with optional auto-layout, fills, parent |
| `create_rectangle` | Rectangle with optional fill, corner radius |
| `create_ellipse` | Ellipse/circle |
| `create_text` | Text node (`text` required, auto font loading) |
| `import_image` | Decode base64 image → rectangle fill (`imageData` required) |

### Write — Modify

| Tool | Description |
|------|-------------|
| `set_text` | Update text content (`nodeId`, `text` required) |
| `set_fills` | Set solid fill color (`nodeId`, `color` hex required) |
| `set_strokes` | Set stroke color and weight (`nodeId`, `color` required) |
| `move_nodes` | Move to absolute x/y (`nodeIds[]` required) |
| `resize_nodes` | Resize by width/height (`nodeIds[]` required) |
| `rename_node` | Rename a node (`nodeId`, `name` required) |
| `clone_node` | Clone with optional reposition/reparent (`nodeId` required) |

### Write — Delete

| Tool | Description |
|------|-------------|
| `delete_nodes` | Delete nodes permanently (`nodeIds[]` required) — use with care |

## Built-in Prompts (6)

| Prompt | Purpose |
|--------|---------|
| `read_design_strategy` | Best practices for reading Figma designs efficiently |
| `design_strategy` | Best practices for creating/modifying designs |
| `text_replacement_strategy` | Chunked approach for bulk text replacement |
| `annotation_conversion_strategy` | Convert manual annotations to native Figma annotations |
| `swap_overrides_instances` | Transfer overrides between component instances |
| `reaction_to_connector_strategy` | Map prototype reactions into flow diagrams |

## Workflow Examples

### Read a design for implementation

```
# 1. Start with an overview
get_metadata()

# 2. Get token-efficient tree of current selection
get_design_context(depth: 3, detail: "compact")

# 3. Drill into specific nodes
get_node(nodeId: "4029:12345")

# 4. Extract all text for content mapping
scan_text_nodes(nodeId: "4029:12345")

# 5. Get design tokens
get_variable_defs()
get_styles()
```

### Create a simple component

```
# 1. Create container frame with auto-layout
create_frame(name: "Card", width: 320, height: 200, fillColor: "#FFFFFF",
             layoutMode: "VERTICAL", paddingTop: 16, paddingRight: 16,
             paddingBottom: 16, paddingLeft: 16, itemSpacing: 8)

# 2. Add text inside (use returned nodeId as parentId)
create_text(text: "Card Title", fontSize: 18, fontFamily: "Inter",
            fontStyle: "Bold", fillColor: "#111827", parentId: "<frame-id>")

# 3. Export a screenshot to verify
get_screenshot(nodeIds: ["<frame-id>"], format: "PNG", scale: 2)
```

### Modify existing design

```
# 1. Find target nodes
search_nodes(query: "Button", types: ["COMPONENT", "INSTANCE"])

# 2. Update properties
set_fills(nodeId: "4029:12345", color: "#3B82F6")
set_text(nodeId: "4029:12346", text: "Get Started")
resize_nodes(nodeIds: ["4029:12345"], width: 160, height: 48)
```

## Tips

- **Always start with `get_metadata`** to understand the file structure
- **Use `get_design_context` with `detail: "minimal"`** for large files — saves tokens
- **Node IDs must use colon format** (`4029:12345`), never hyphens
- **Batch reads** with `get_nodes_info` instead of multiple `get_node` calls
- **All write operations are undoable** in Figma (Cmd/Ctrl+Z)
- **Check selection** with `get_selection` before operations that act on selection
- **Use built-in prompts** for complex workflows — they contain expert strategies

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Connection refused" / timeout | Ensure Figma Desktop is open and the plugin is running |
| "No selection" errors | Select nodes in Figma first, or pass explicit `nodeId`/`nodeIds` |
| Plugin shows disconnected | Re-run the plugin in Figma; check that port 1994 is free |
| Multiple AI tools conflict | Normal — leader/follower election handles this automatically |
| Large file slow responses | Use `get_design_context` with `detail: "minimal"` and lower `depth` |

## Comparison: figma-mcp-go vs figma (Framelink)

| Feature | figma-mcp-go (this skill) | figma (Framelink) |
|---------|--------------------------|-------------------|
| API Token | Not needed | Required (`FIGMA_API_KEY`) |
| Rate Limits | None (plugin bridge) | 6/month on free plan |
| Read Access | Full (35 tools) | Yes (2 tools) |
| Write Access | Yes (create, modify, delete) | No |
| Requires Figma Desktop | Yes (plugin must run) | No (REST API) |
| Setup | Install plugin + npx | Set env var + npx |
