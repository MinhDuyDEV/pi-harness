---
name: pencil
description: AI-powered design tool for creating and editing .pen design files via MCP. Full read/write access to Pencil's design engine — create UI designs, modify layouts, manage design variables/themes, generate screenshots, and export assets. Requires Pencil Desktop app running.
version: 1.0.0
tags: [design, ui, mcp, pencil, pen]
dependencies: []
---

# Pencil Design (MCP)

Create and edit `.pen` design files through Pencil's native MCP server. Connects directly to the running Pencil Desktop app — full read/write access to the design canvas with AI image generation, theming, and headless rendering.

## When to Use

- Creating UI designs from scratch (landing pages, dashboards, forms, component libraries)
- Modifying existing `.pen` design files (add/remove/update nodes)
- Extracting design tokens (variables, colors, typography, spacing)
- Generating screenshots or exporting assets (PNG/JPEG/WEBP/PDF)
- Building and managing design systems with reusable components
- Searching and batch-replacing design properties across a file
- AI-generating or inserting stock images into designs

## When NOT to Use

- Pencil Desktop app is not running (MCP server requires a live app connection)
- Working with Figma files (use `figma` or `figma-go` skills instead)
- Working with Stitch/Google designs (use `stitch` skill instead)
- Pure code-only tasks with no design involvement

## Prerequisites

### 1. Install Pencil Desktop

Download from [pencil.dev](https://pencil.dev) and install:
- **macOS**: Drag `Pencil.app` to Applications
- **Linux**: `.deb` or `.AppImage`
- **Windows**: Installer

### 2. Authenticate

```bash
# Via Pencil CLI (for headless/batch use)
npx @pencil.dev/cli login

# Or just open Pencil Desktop and complete activation
```

Sessions are stored in `~/.pencil/session-desktop.json`.

### 3. Run Pencil Desktop

The MCP server connects to the running app. Open Pencil Desktop and ensure a `.pen` file is open.

### 4. Verify MCP Connection

```
mcp({ server: "pencil" })
```

If tools appear, Pencil MCP is connected.

## Available Tools

### Document & Structure

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_editor_state` | Get document metadata, structure, and optionally the full schema | `include_schema?: boolean` |
| `snapshot_layout` | Get document structure with computed bounds for all nodes | — |
| `find_empty_space_on_canvas` | Find available space for placing new elements | — |

### Design Operations

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `batch_design` | Insert, update, delete, move, copy, replace nodes | `operations: string` (DSL expression) |
| `batch_get` | Search and read nodes by pattern or ID | `patterns?: object[]`, `ids?: string[]` |

### Variables & Theming

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_variables` | Read all design variables (colors, numbers, strings) | — |
| `set_variables` | Create or update design variables | `variables: object` |

### Property Operations

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `search_all_unique_properties` | Recursively search for unique property values on a node tree | `nodeId?: string` |
| `replace_all_matching_properties` | Recursively replace matching property values on a node tree | `nodeId?: string`, `replacements: object` |

### Visual & Export

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_screenshot` | Render a node to PNG image | `nodeId: string` |
| `export_nodes` | Export nodes to PNG/JPEG/WEBP/PDF | `nodeIds: string[]`, `format: string` |

### Guidelines & Style

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_guidelines` | Load design guides and styles for working with .pen files | `category?: string`, `name?: string` |

## batch_design Operations DSL

The `batch_design` tool uses a compact DSL for operations:

```
# Insert a new node
I(parentId, { type: "frame", name: "Hero", x: 0, y: 0, width: 1440, height: 900, fill: "#0A0A0A" })

# Update an existing node
U(nodeId, { fill: "#FF0000", cornerRadius: 8 })

# Delete a node
D(nodeId)

# Move a node
M(nodeId, { x: 100, y: 200 })

# Copy a node
C(nodeId, { x: 300, y: 0 })

# Replace a node
R(nodeId, { type: "text", content: "New Text" })

# Generate AI image
G(nodeId, "ai", "A beautiful sunset over mountains")

# Insert stock photo
G(nodeId, "stock", "office workspace laptop")
```

Multiple operations can be chained with variable assignment:

```
hero=I(document, { type: "frame", name: "Hero", x: 0, y: 0, width: 1440, height: 900, fill: "#0A0A0A" })
```

## Workflows

### Create a New Design

```
# 1. Check the document state and load the schema
get_editor_state({ include_schema: true })

# 2. Load design guidelines
get_guidelines()
get_guidelines({ category: "guide", name: "Landing Page" })

# 3. Create the main frame
batch_design({ operations: 'hero=I(document, { type: "frame", name: "Hero", x: 0, y: 0, width: 1440, height: 900, fill: "#0A0A0A" })' })

# 4. Add child elements
batch_design({ operations: 'I(hero, { type: "text", content: "Welcome", fontSize: 72, fill: "#FFFFFF" })' })

# 5. Verify with screenshot
get_screenshot({ nodeId: "hero" })
```

### Inspect & Modify an Existing Design

```
# 1. Get the document overview
get_editor_state()

# 2. Find specific elements
batch_get({ patterns: [{ type: "text" }] })
batch_get({ patterns: [{ reusable: true }] })  # Find components

# 3. Get design tokens
get_variables()

# 4. Modify elements
batch_design({ operations: 'U(nodeId, { fill: "#3B82F6", cornerRadius: 12 })' })

# 5. Verify changes
get_screenshot({ nodeId: "parentFrame" })
```

### Build a Design System

```
# 1. Define variables (design tokens)
set_variables({
  variables: {
    "color.primary": { type: "color", value: "#3B82F6" },
    "color.secondary": { type: "color", value: "#10B981" },
    "color.background": { type: "color", value: [
      { value: "#FFFFFF", theme: { mode: "light" } },
      { value: "#0A0A0A", theme: { mode: "dark" } }
    ]},
    "spacing.sm": { type: "number", value: 8 },
    "spacing.md": { type: "number", value: 16 },
    "spacing.lg": { type: "number", value: 32 }
  }
})

# 2. Create reusable components
batch_design({ operations: 'I(document, { type: "frame", name: "Button", reusable: true, cornerRadius: 8, fill: "$color.primary", layout: "horizontal", padding: [12, 24], children: [{ id: "label", type: "text", content: "Button", fill: "#FFFFFF" }] })' })

# 3. Create instances
batch_design({ operations: 'I(document, { type: "ref", ref: "Button", x: 0, y: 200, descendants: { "label": { content: "Sign In" } } })' })
```

### Export Assets

```
# Screenshot as PNG
get_screenshot({ nodeId: "hero-section" })

# Export multiple nodes
export_nodes({ nodeIds: ["icon-home", "icon-settings"], format: "png" })

# Export to PDF
export_nodes({ nodeIds: ["full-page"], format: "pdf" })
```

### Search & Replace Properties

```
# Find all unique fill colors used
search_all_unique_properties({ nodeId: "root-frame" })

# Replace all instances of a color
replace_all_matching_properties({
  nodeId: "root-frame",
  replacements: {
    fill: { from: "#FF0000", to: "#3B82F6" }
  }
})
```

## .pen File Format Reference

`.pen` files contain a JSON object tree:

```json
{
  "version": "2.9",
  "themes": { "mode": ["light", "dark"] },
  "variables": {
    "color.primary": { "type": "color", "value": "#3B82F6" }
  },
  "children": [
    {
      "id": "hero",
      "type": "frame",
      "x": 0, "y": 0,
      "width": 1440, "height": 900,
      "fill": "$color.primary",
      "children": [...]
    }
  ]
}
```

### Node Types

| Type | Description |
|------|-------------|
| `frame` | Container with optional layout (flexbox), clipping, children |
| `rectangle` | Basic rectangle with corner radius |
| `ellipse` | Circle/ellipse with optional arc |
| `text` | Text node with rich typography |
| `line` | Line element |
| `polygon` | Regular polygon |
| `path` | SVG path |
| `icon_font` | Icon from font (lucide, feather, Material Symbols, phosphor) |
| `group` | Grouping container |
| `ref` | Instance of a reusable component |
| `note` | Design note |
| `context` | Context annotation |

### Key Concepts

- **Reusable components**: Any node with `reusable: true` becomes a component
- **Instances**: `ref` nodes reference components, with optional `descendants` overrides
- **Variables**: Prefix with `$` to bind (e.g., `fill: "$color.primary"`)
- **Themes**: Variables can have multiple values per theme axis
- **Layout**: Flexbox via `layout: "vertical" | "horizontal"`, `gap`, `padding`, `justifyContent`, `alignItems`
- **Sizing**: `"fit_content"` or `"fill_container"` with optional fallback

## Architecture

```
Pi Agent ←stdio→ Pencil MCP Server Binary ←IPC→ Pencil Desktop App ←Engine→ .pen Files
```

- MCP server binary: `/Applications/Pencil.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64`
- Connects to running Pencil Desktop via `--app desktop`
- All operations are live — changes appear immediately on canvas
- Headless rendering via CanvasKit for screenshots/exports

## CLI Alternative (Headless)

For batch/CI workflows without the Desktop app:

```bash
# Install
npm install -g @pencil.dev/cli

# Authenticate
pencil login

# Create design headlessly
pencil --out design.pen --prompt "Create a login page"

# Interactive shell
pencil interactive -o output.pen

# Export to image
pencil --in design.pen --export hero.png --export-scale 2
```

Requires `PENCIL_CLI_KEY` or `ANTHROPIC_API_KEY` environment variable for AI features.

## Comparison with Other Design Skills

| Feature | Pencil | Stitch | Figma (REST) | Figma-Go (Plugin) |
|---------|--------|--------|--------------|-------------------|
| Format | `.pen` (JSON) | Cloud (HTML/CSS) | Cloud (Figma) | Cloud (Figma) |
| Auth | Session/CLI key | API key/OAuth | API key | None (plugin) |
| Write access | Full | Full | No | Full |
| Local files | Yes | No (cloud) | No (cloud) | No (cloud) |
| AI generation | Built-in | Built-in | No | No |
| Offline support | Partial (export) | No | No | Desktop only |
| Component system | Yes (ref/reusable) | No | Yes | Yes |
| Theming | Yes (multi-axis) | No | Variables | Variables |
| Best for | Design files, systems | Quick HTML prototypes | API access, CI/CD | Interactive Figma |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Server not responding" | Ensure Pencil Desktop is running with a `.pen` file open |
| "Connection refused" | Restart Pencil Desktop, then retry `mcp({ connect: "pencil" })` |
| "Authentication required" | Run `pencil login` or ensure `~/.pencil/session-desktop.json` exists |
| MCP binary not found | Verify Pencil Desktop is installed in `/Applications/Pencil.app` |
| Tools not discovered | Run `mcp({ connect: "pencil" })` to force metadata refresh |
| Schema validation errors | Update Pencil Desktop to latest version |

## Tips

- **Start with `get_editor_state({ include_schema: true })`** — loads the full .pen schema for reference
- **Load guidelines first** — `get_guidelines()` provides design best practices
- **Use variables** — `$variable.name` syntax keeps designs consistent and themeable
- **Make components reusable** — Set `reusable: true` on frames, then use `ref` instances
- **Verify visually** — Call `get_screenshot()` after major changes to confirm appearance
- **Batch operations** — Chain multiple operations in a single `batch_design` call
- **Find space first** — Use `find_empty_space_on_canvas` before placing new top-level frames

## Documentation

- [Pencil Documentation](https://docs.pencil.dev)
- [Pencil CLI Reference](https://docs.pencil.dev/for-developers/pencil-cli)
- [.pen Format Specification](https://docs.pencil.dev/for-developers/the-pen-format)
- [AI Integration Guide](https://docs.pencil.dev/getting-started/ai-integration)
