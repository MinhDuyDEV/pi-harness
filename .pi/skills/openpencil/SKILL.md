---
name: openpencil
description: Open-source AI-native vector design tool with concurrent agent teams, multi-model intelligence, and multi-platform code export. Create and edit .op design files via MCP or CLI. Supports React, Vue, Svelte, Flutter, SwiftUI, Compose, React Native export. Requires OpenPencil app running.
version: 1.0.0
tags: [design, ui, mcp, openpencil, open-source, code-export]
dependencies: []
---

# OpenPencil (MCP)

Open-source AI-native vector design tool — the first with concurrent Agent Teams. Create and edit `.op` design files through a built-in MCP server or the `op` CLI. Full read/write canvas access, multi-platform code export, Figma import, and design system management.

## When to Use

- Creating UI designs from prompts (landing pages, dashboards, forms, apps)
- Modifying existing `.op` design files
- **Exporting designs to code**: React+Tailwind, HTML+CSS, Vue, Svelte, Flutter, SwiftUI, Jetpack Compose, React Native
- Importing Figma `.fig` files into OpenPencil
- Building design systems with variables, themes, and reusable components
- Multi-page document management
- Layered AI design generation (skeleton → content → refine)
- Importing SVG files as editable nodes

## When NOT to Use

- OpenPencil is not running (MCP tools need a live app or web server)
- Working with `.pen` files (use `pencil` skill for Pencil.dev)
- Working with Figma live editing (use `figma-go` skill)
- Pure code-only tasks with no design involvement

## Prerequisites

### 1. Install OpenPencil

**Desktop app (recommended):**
```bash
# macOS
brew tap zseven-w/openpencil && brew install --cask openpencil

# Windows
scoop bucket add openpencil https://github.com/zseven-w/scoop-openpencil
scoop install openpencil

# Linux — download .AppImage or .deb from GitHub Releases
```

**CLI tool:**
```bash
npm install -g @zseven-w/openpencil
```

**Docker (web only):**
```bash
docker run -d -p 3000:3000 ghcr.io/zseven-w/openpencil:latest
```

### 2. Start OpenPencil

```bash
# Desktop
op start --desktop

# Or web dev server
op start --web   # runs at http://localhost:3000
```

### 3. Verify MCP Connection

```
mcp({ connect: "openpencil" })
mcp({ server: "openpencil" })
```

## Available MCP Tools (32 tools)

### Document & Structure

| Tool | Description |
|------|-------------|
| `open_document` | Open .op file or connect to live canvas. **Always call first.** Returns doc metadata + design prompt |
| `batch_get` | Search/read nodes by type, name regex, ID, or parent. `readDepth` controls nesting |
| `get_selection` | Get currently selected nodes on live canvas |
| `snapshot_layout` | Hierarchical bounding box layout tree |
| `find_empty_space` | Find empty canvas space in a given direction (top/right/bottom/left) |

### Node CRUD

| Tool | Description |
|------|-------------|
| `insert_node` | Insert new node (frame, text, rectangle, ellipse, path, image, group, line, polygon, ref) |
| `update_node` | Shallow-merge properties on existing node |
| `delete_node` | Delete node and all children |
| `move_node` | Move node to new parent |
| `copy_node` | Deep-copy with new IDs, optional overrides |
| `replace_node` | Replace node entirely with new data |

### Batch Design (DSL)

| Tool | Description |
|------|-------------|
| `batch_design` | Execute compact DSL operations: `I(insert)`, `U(update)`, `C(copy)`, `R(replace)`, `M(move)`, `D(delete)` |

### Layered Design Workflow

| Tool | Description |
|------|-------------|
| `design_skeleton` | Phase 1: Create layout skeleton with section placeholders |
| `design_content` | Phase 2: Fill a specific section with detailed content |
| `design_refine` | Phase 3: Polish visual quality and consistency |

### Variables, Themes & Design System

| Tool | Description |
|------|-------------|
| `get_variables` | Read all design variables |
| `set_variables` | Add/update design variables (merge or replace) |
| `set_themes` | Create/update theme axes (e.g., Light/Dark, Compact/Comfortable) |
| `get_design_md` | Get design.md (design system specification) |
| `set_design_md` | Import design.md or auto-extract from document |
| `export_design_md` | Export design system as markdown |
| `save_theme_preset` | Save themes+variables as reusable .optheme file |
| `load_theme_preset` | Load .optheme preset into document |
| `list_theme_presets` | List .optheme files in a directory |

### Pages

| Tool | Description |
|------|-------------|
| `add_page` | Add new page (auto-migrates if first multi-page) |
| `remove_page` | Remove page (cannot remove last) |
| `rename_page` | Rename a page |
| `reorder_page` | Move page to new index |
| `duplicate_page` | Deep-clone page with new IDs |

### Import & Export

| Tool | Description |
|------|-------------|
| `import_svg` | Import SVG file as editable PenNodes |
| `export_nodes` | Export raw PenNode data with variables/themes |
| `get_design_prompt` | Get design knowledge prompt (segmented: schema, layout, roles, text, style, icons, examples, guidelines, planning) |

## batch_design DSL

```
# Insert node (binding captures new ID)
root=I(null, { "type": "frame", "name": "Page", "width": 1200, "height": 0, "layout": "vertical" })

# Insert child
header=I(root, { "type": "frame", "name": "Header", "role": "navbar", "width": 1200, "height": 64 })

# Update properties
U(header, { "fill": [{ "type": "solid", "color": "#1A1A2E" }] })

# Copy node
footer=C(header, null, { "name": "Footer", "role": "footer" })

# Replace node
R(header, { "type": "frame", "name": "NewHeader", "width": 1200, "height": 80 })

# Move node
M(footer, root, 0)

# Delete node
D(footer)
```

**Important:** Always set `postProcess: true` for design generation — it applies role defaults, icon resolution, and layout sanitization.

## Layered Design Workflow

For complex multi-section designs, use the 3-phase approach:

```
# Phase 1: Create skeleton with section placeholders
design_skeleton({
  description: "SaaS landing page with hero, features, pricing, and footer",
  canvasWidth: 1200
})

# Phase 2: Fill each section with content
design_content({ sectionId: "hero-section", description: "Hero with headline, subtext, and CTA" })
design_content({ sectionId: "features-section", description: "3-column feature grid with icons" })
design_content({ sectionId: "pricing-section", description: "3-tier pricing table" })

# Phase 3: Refine visual polish
design_refine({ rootId: "root-frame" })
```

## CLI Commands (`op`)

The `op` CLI connects to the running app via WebSocket:

```bash
# Design
op design '...'              # Batch design DSL
op design @landing.txt       # From file
cat design.txt | op design - # From stdin

# Document
op open [file.op]            # Open file
op save <file.op>            # Save
op get [--type X] [--name Y] # Query nodes
op selection                 # Get selection

# Node CRUD
op insert <json> [--parent P]
op update <id> <json>
op delete <id>
op move <id> --parent <P>
op copy <id> [--parent P]
op replace <id> <json>

# Code Export (8 platforms!)
op export react --out .
op export html --out .
op export vue --out .
op export svelte --out .
op export flutter --out .
op export swiftui --out .
op export compose --out .
op export rn --out .

# Variables & Themes
op vars                      # Get variables
op vars:set <json>           # Set variables
op themes                    # Get themes
op themes:set <json>         # Set themes

# Pages
op page list / add / remove / rename / reorder / duplicate

# Import
op import:svg <file.svg>
op import:figma <file.fig>

# Layout
op layout [--parent P]
op find-space [--direction right]
```

## .op File Format

`.op` files are JSON — human-readable, Git-friendly, diffable:

```json
{
  "version": "2.0",
  "pages": [
    {
      "id": "page-1",
      "name": "Landing Page",
      "children": [
        {
          "id": "hero",
          "type": "frame",
          "name": "Hero",
          "role": "hero",
          "width": 1200,
          "height": 600,
          "layout": "vertical",
          "fill": [{ "type": "solid", "color": "#0A0A0A" }],
          "children": [...]
        }
      ]
    }
  ],
  "variables": {
    "color-primary": { "type": "color", "value": "#3B82F6" }
  },
  "themes": {
    "Color Scheme": ["Light", "Dark"]
  }
}
```

### Node Types

| Type | Description |
|------|-------------|
| `frame` | Container with layout (none/vertical/horizontal), gap, padding, children |
| `text` | Text with content, fontSize, fontWeight, fontFamily, textGrowth |
| `rectangle` | Rectangle with cornerRadius, fill, stroke |
| `ellipse` | Circle/ellipse |
| `line` | Line element |
| `polygon` | Regular polygon |
| `path` | SVG path (d string) or named icon |
| `image` | Image with src URL |
| `group` | Grouping container |
| `ref` | Instance of reusable component |

### Key Concepts

- **Roles**: Semantic roles (`navbar`, `hero`, `card`, `footer`, etc.) — 40+ roles with smart defaults applied by post-processing
- **Fill format**: Always an array: `[{ type: "solid", color: "#hex" }]`
- **Variables**: Prefix with `$` to bind (e.g., `"$color-primary"`)
- **Themes**: Multiple axes with variants (Light/Dark, Compact/Comfortable)
- **Layout**: Flexbox via `layout`, `gap`, `padding`, `justifyContent`, `alignItems`
- **Post-processing**: Role defaults, icon resolution, layout sanitization — always enable for AI generation

## Code Export Formats

| Format | Output |
|--------|--------|
| `react` | React + Tailwind CSS components |
| `html` | HTML + CSS |
| `vue` | Vue SFC components |
| `svelte` | Svelte components |
| `flutter` | Flutter/Dart widgets |
| `swiftui` | SwiftUI views |
| `compose` | Jetpack Compose (Kotlin) |
| `rn` | React Native components |
| `css` | CSS custom properties only |

Design variables auto-generate CSS custom properties (`var(--name)`) in code output.

## Workflows

### Create a Landing Page

```
# 1. Connect to live canvas
open_document()

# 2. Load design knowledge
get_design_prompt({ section: "schema" })
get_design_prompt({ section: "roles" })

# 3. Layered design
design_skeleton({ description: "Modern SaaS landing page", canvasWidth: 1200 })
design_content({ sectionId: "hero", description: "Bold hero with gradient background" })
design_content({ sectionId: "features", description: "3-column feature cards" })
design_refine({ rootId: "root" })
```

### Import Figma and Export to React

```bash
# Import
op import:figma design.fig

# Export
op export react --out ./src/components
```

### Build a Design System

```
# Define variables
set_variables({
  variables: {
    "color-primary": { type: "color", value: "#3B82F6" },
    "color-bg": { type: "color", value: "#FFFFFF" },
    "spacing-md": { type: "number", value: 16 },
    "radius-md": { type: "number", value: 8 }
  }
})

# Set themes
set_themes({
  themes: {
    "Color Scheme": ["Light", "Dark"],
    "Density": ["Comfortable", "Compact"]
  }
})

# Save as reusable preset
save_theme_preset({ presetPath: "./my-theme.optheme" })
```

## Architecture

```
Pi Agent ←HTTP /mcp→ OpenPencil Web App (localhost:3000)
                         ↕
                     CanvasKit/Skia (GPU-accelerated WASM renderer)
                         ↕
                     .op Files (JSON, Git-friendly)

OR via CLI:

Pi Agent ←bash→ op CLI ←WebSocket→ OpenPencil Desktop/Web ← .op Files
```

- MCP server is built into the OpenPencil web/desktop app
- HTTP transport at `/mcp` endpoint
- stdio transport also available
- All operations are live — changes appear immediately on canvas

## Comparison with Pencil.dev

| Feature | OpenPencil | Pencil.dev |
|---------|------------|------------|
| License | MIT (open-source) | Proprietary |
| AI Models | 9+ providers | Claude only |
| Agent Teams | Concurrent parallel agents | Single agent |
| Code Export | 8 platforms | None built-in |
| Figma Import | Yes (.fig) | No |
| MCP Tools | 32 tools | 12 tools |
| File Format | `.op` (JSON) | `.pen` (JSON) |
| Collaboration | P2P WebRTC | No |
| Prototyping | No (use code export) | No |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Connection refused" | Ensure OpenPencil is running: `op start` or launch desktop app |
| "MCP not responding" | Check web server at `http://localhost:3000`, restart app |
| CLI "op not found" | Install: `npm install -g @zseven-w/openpencil` |
| Desktop app not found | Install via Homebrew: `brew install --cask openpencil` |
| Figma import fails | Ensure `.fig` file is valid, not a Figma URL |
| Export empty output | Make sure nodes exist on the target page |

## Tips

- **Start with `open_document()`** — always call first to connect and load context
- **Use `get_design_prompt(section=...)`** — load only the knowledge you need to save tokens
- **Layered workflow** — `skeleton → content → refine` produces higher-fidelity results than single-shot
- **Always `postProcess: true`** — applies role defaults, icons, and layout fixes
- **40+ semantic roles** — use `role` property for smart defaults (navbar, hero, card, etc.)
- **Export to code** — `op export react` directly generates production components
- **Import from Figma** — `op import:figma design.fig` converts .fig to .op
- **Design.md** — use `set_design_md` to teach the AI your design system
- **Theme presets** — save/load `.optheme` files for reusable design tokens

## Documentation

- [OpenPencil GitHub](https://github.com/ZSeven-W/openpencil)
- [CLI Reference](https://github.com/ZSeven-W/openpencil/blob/main/apps/cli/README.md)
- [OpenPencil Skill (LLM Plugin)](https://github.com/ZSeven-W/openpencil-skill)
- [Demo](https://op.zseven.tech)
