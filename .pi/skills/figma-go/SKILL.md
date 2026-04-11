---
name: figma-go
description: Use when you need Figma read/write access WITHOUT an API token, via figma-mcp-go plugin bridge. Prefer over figma skill when no API token is available. MUST load when user needs Figma data and has the desktop plugin installed.
mcp:
  figma-mcp-go:
    command: npx
    args: ["-y", "@vkhanhqui/figma-mcp-go@latest"]
version: 1.0.0
tags: [design, mcp, figma]
dependencies: []
---

# Figma MCP (figma-mcp-go)

## When to Use

- You need **read/write** access to live Figma documents without API rate limits.
- You want to generate designs or modify existing Figma files via MCP.

## When NOT to Use

- You only need static exports (use existing asset pipeline).
- You don’t have access to Figma Desktop or can’t install plugins.

## Prerequisites (one-time setup)

1. **Install the Figma plugin**

- Download `plugin.zip` from: https://github.com/vkhanhqui/figma-mcp-go/releases
- In Figma Desktop: **Plugins → Development → Import plugin from manifest**
- Select `manifest.json` inside `plugin.zip`
- Run the plugin inside any Figma file

2. **Ensure MCP server runs via OpenCode**

- This skill starts the MCP server with:
  `npx -y @vkhanhqui/figma-mcp-go@latest`
- No `FIGMA_API_KEY` is required.

## Quick Start

```bash
skill_mcp(skill_name="figma-go", tool_name="get_metadata", arguments='{}')
```

## Common Tools

- **Read**: `get_document`, `get_pages`, `get_node`, `get_nodes_info`, `get_design_context`
- **Write**: `create_frame`, `create_text`, `set_text`, `set_fills`, `move_nodes`, `resize_nodes`, `delete_nodes`
- **Export**: `get_screenshot`, `save_screenshots`

## Example: Read a Frame

```bash
skill_mcp(skill_name="figma-go", tool_name="get_node", arguments='{"node_id":"1234:5678"}')
```

## Notes

- This MCP uses a **plugin bridge**, so Figma Desktop must be running with the plugin active.
- If tools fail, re-run the plugin inside the open Figma file.
- If you see `Invalid schema for function 'figma-mcp-go_delete_nodes'`, keep the
  global `mcp.figma-mcp-go` entry **disabled** in `opencode.json` and use this skill
  (via `skill_mcp`) until upstream fixes the schema.
- Full tool list and prompts: https://github.com/vkhanhqui/figma-mcp-go#available-tools
