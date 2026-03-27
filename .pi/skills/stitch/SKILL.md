---
name: stitch
description: Google Stitch MCP for AI-powered UI design. Extract design context, generate code from designs, and create screens from descriptions. Use when working with Stitch designs and UI generation.
mcp:
  stitch:
    command: npx
    args: ["-y", "@_davideast/stitch-mcp", "proxy"]
    env:
      STITCH_PROJECT_ID: "${STITCH_PROJECT_ID}"
version: 1.0.0
tags: [design, mcp, ui, google, stitch]
dependencies: []
---

# Google Stitch MCP

## When to Use

- Generating UI screens from text prompts via Gemini
- Editing existing Stitch designs with AI
- Extracting production-ready HTML/CSS from Stitch screens
- Building multi-page sites from Stitch projects
- Browsing and managing Stitch projects and screens

## When NOT to Use

- When you don't have Stitch access or a Google Cloud project
- For non-UI tasks unrelated to design generation

## Overview

[Stitch](https://stitch.withgoogle.com) is Google's Gemini-powered AI platform that generates production-ready HTML/CSS UI designs from text prompts. This skill uses [`@_davideast/stitch-mcp`](https://github.com/davideast/stitch-mcp) — a proxy that bridges Stitch's API to any MCP-compatible agent with automatic OAuth token refresh.

The proxy exposes **8 upstream tools** (from `@google/stitch-sdk`) and **3 virtual tools** (higher-level operations built on top).

> **Note:** `@_davideast/stitch-mcp` is an independent, experimental project — not officially affiliated with Google.

## Prerequisites

### First-Time Setup

Run the interactive setup wizard:

```bash
npx @_davideast/stitch-mcp init
```

This handles: gcloud auth, OAuth login, project selection, IAM roles, and API enablement.

### Environment Variable

Set your Google Cloud project ID:

```bash
export STITCH_PROJECT_ID="devops-on-cloud-451119"
```

The proxy uses OAuth tokens (auto-refreshed) — no API key needed.

### Alternative: API Key

If you prefer API key auth instead of OAuth:

```bash
export STITCH_API_KEY="your-api-key"
```

### Verify Setup

```bash
npx @_davideast/stitch-mcp doctor --verbose
```

## Available Tools

### Project Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_project` | Create a new Stitch project | `title?: string` |
| `get_project` | Get project details | `name: string` — format: `projects/{id}` |
| `list_projects` | List all accessible projects | `filter?: string` — e.g. `view=owned` or `view=shared` |

### Screen Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_screens` | List all screens in a project | `projectId: string` |
| `get_screen` | Get screen details (HTML URL + screenshot) | `name: string`, `projectId: string`, `screenId: string` |

### AI Generation

| Tool | Description | Parameters |
|------|-------------|------------|
| `generate_screen_from_text` | Generate a new screen from a text prompt | `projectId: string`, `prompt: string`, `deviceType?: MOBILE\|DESKTOP\|TABLET\|AGNOSTIC`, `modelId?: GEMINI_3_PRO\|GEMINI_3_FLASH` |
| `edit_screens` | Edit existing screens with a text prompt | `projectId: string`, `selectedScreenIds: string[]`, `prompt: string`, `deviceType?`, `modelId?` |
| `generate_variants` | Generate design variants of screens | `projectId: string`, `selectedScreenIds: string[]`, `prompt: string`, `variantOptions: {variantCount?: 1-5, creativeRange?: REFINE\|EXPLORE\|REIMAGINE, aspects?: (LAYOUT\|COLOR_SCHEME\|IMAGES\|TEXT_FONT\|TEXT_CONTENT)[]}`, `deviceType?`, `modelId?` |

### Virtual Tools (proxy-added)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_screen_code` | Download full HTML code for a screen | `projectId: string`, `screenId: string` |
| `get_screen_image` | Download screen screenshot as base64 | `projectId: string`, `screenId: string` |
| `build_site` | Build a multi-page site from screens mapped to routes | `projectId: string`, `routes: [{screenId: string, route: string}]` |

> **Important:** `generate_screen_from_text`, `edit_screens`, and `generate_variants` can take several minutes. Do **not** retry on timeout — check with `get_screen` afterward.

## Usage Examples

### List Your Projects

```
mcp({ tool: "list_projects", args: '{}', server: "stitch" })
```

### Create a Project

```
mcp({ tool: "create_project", args: '{"title": "My E-commerce App"}', server: "stitch" })
```

### Generate a Screen from Text

```
mcp({ tool: "generate_screen_from_text", args: '{"projectId": "123456", "prompt": "Modern login page with email/password fields, social login buttons, and forgot password link", "deviceType": "MOBILE"}', server: "stitch" })
```

### Edit an Existing Screen

```
mcp({ tool: "edit_screens", args: '{"projectId": "123456", "selectedScreenIds": ["screen-abc"], "prompt": "Change the primary button color to blue and add a dark mode toggle"}', server: "stitch" })
```

### Generate Design Variants

```
mcp({ tool: "generate_variants", args: '{"projectId": "123456", "selectedScreenIds": ["screen-abc"], "prompt": "Create variations with different color schemes", "variantOptions": {"variantCount": 3, "creativeRange": "EXPLORE", "aspects": ["COLOR_SCHEME", "LAYOUT"]}}', server: "stitch" })
```

### Get Screen HTML Code

```
mcp({ tool: "get_screen_code", args: '{"projectId": "123456", "screenId": "screen-abc"}', server: "stitch" })
```

### Build a Multi-Page Site

```
mcp({ tool: "build_site", args: '{"projectId": "123456", "routes": [{"screenId": "screen-home", "route": "/"}, {"screenId": "screen-about", "route": "/about"}, {"screenId": "screen-dashboard", "route": "/dashboard"}]}', server: "stitch" })
```

## Workflow: Design → Code

1. **Browse projects** — `list_projects` → find your project ID
2. **List screens** — `list_screens` with `projectId` → see available screens
3. **Generate or pick a screen** — `generate_screen_from_text` or select existing
4. **Get the HTML** — `get_screen_code` → returns production-ready HTML/CSS
5. **Implement** — Convert the HTML into your framework (React, Next.js, etc.)

## Workflow: Build Full Site

1. **List screens** — `list_screens` to see all designs
2. **Map routes** — Decide which screen maps to which URL path
3. **Build** — `build_site` with route mappings → returns HTML for each page
4. **Deploy** — Output is an Astro-compatible project structure

## CLI Commands (outside MCP)

```bash
# Interactive project/screen browser
npx @_davideast/stitch-mcp view --projects

# Preview all screens locally (Vite dev server)
npx @_davideast/stitch-mcp serve -p <projectId>

# Build a deployable Astro site
npx @_davideast/stitch-mcp site -p <projectId>

# List all available tools
npx @_davideast/stitch-mcp tool

# Show tool schema
npx @_davideast/stitch-mcp tool generate_screen_from_text -s
```

## Troubleshooting

### "Authentication failed"

- **API Key**: Verify `STITCH_API_KEY` is set correctly
- **OAuth**: Run `npx @_davideast/stitch-mcp init` to re-authenticate
- **Token expired**: The proxy auto-refreshes OAuth tokens, but if issues persist restart the MCP server

### "Stitch API not enabled"

```bash
gcloud beta services mcp enable stitch.googleapis.com --project=YOUR_PROJECT_ID
```

### "Generation timed out"

Generation can take several minutes. Don't retry — check with `get_screen` to see if it completed.

### Debug Mode

Add `--debug` to the proxy command for detailed logs at `/tmp/stitch-proxy-debug.log`:

```bash
npx @_davideast/stitch-mcp proxy --debug
```

## Documentation

- [Google Stitch](https://stitch.withgoogle.com)
- [stitch-mcp GitHub](https://github.com/davideast/stitch-mcp)
- [npm: @_davideast/stitch-mcp](https://www.npmjs.com/package/@_davideast/stitch-mcp)
- [@google/stitch-sdk](https://github.com/google-labs-code/stitch-sdk)

## Tips

- Use descriptive, detailed prompts for better AI generation results
- `GEMINI_3_PRO` produces higher quality; `GEMINI_3_FLASH` is faster
- Set `deviceType` to match your target — `MOBILE`, `DESKTOP`, `TABLET`, or `AGNOSTIC`
- `get_screen_code` returns resolved HTML (not just a URL) — ready to use
- `build_site` maps screens to routes for a complete multi-page site
- The response from `generate_screen_from_text` may include `suggestion` fields — present these to the user
