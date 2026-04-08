---
name: pencil
description: Use when working with OpenPencil .op design files — creating, editing, or exporting code from designs. MUST load before any OpenPencil workflow. Requires desktop app (npm CLI does not provide openpencil-mcp).
version: 1.0.0
tags: [design, openpencil, mcp, cli]
mcp:
  pencil:
    command: openpencil-mcp
---

# OpenPencil Skill

Legacy skill name: `pencil`.

## When to Use

- Create or modify UI designs as code using `.op` files.
- Export production code or visuals from the terminal.
- Use OpenPencil's desktop-bundled MCP server after installing the app.

## Prerequisites

### Install CLI

```bash
npm install -g @zseven-w/openpencil
op status
```

### Install Desktop App for MCP

- Install the OpenPencil desktop app from the ZSeven-W/openpencil releases page.
- Open **Agent Settings** inside OpenPencil and use the one-click MCP install for OpenCode/Claude Code/Codex/etc.
- The npm CLI install does **not** provide `openpencil-mcp`; that binary is bundled with the desktop app.

### MCP Server

- OpenPencil ships a built-in MCP server for agent tooling.
- The server command is `openpencil-mcp` once the desktop app has installed/exposed it.
- Keep MCP disabled in template config until OpenPencil desktop is installed locally.

## Quick Start

```bash
# Create new design
op design @landing.txt

# Start the desktop app
op start

# Export code
op export react --out .

# Import a Figma file
op import:figma design.fig
```

## Core CLI Commands

- `op design @brief.txt`
- `op design:skeleton`
- `op design:content`
- `op design:refine --root-id <id>`
- `op export react --out .`
- `op import:figma design.fig`

## Notes

- OpenPencil uses `.op` files as the source of truth.
- CLI install is published on npm as `@zseven-w/openpencil` and exposes the `op` binary.
- MCP is a desktop-app-bundled feature, not a standalone npm package.
- Use taste-skill for design quality, OpenPencil for execution.
