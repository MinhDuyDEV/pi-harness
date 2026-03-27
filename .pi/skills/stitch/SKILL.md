---
name: stitch
description: Google Stitch AI-powered UI design via native extension. Generate production-ready HTML/CSS from text prompts, edit screens, extract code, and build multi-page sites. Use when working with Stitch designs and UI generation.
version: 2.0.0
tags: [design, ui, google, stitch, extension]
dependencies: []
---

# Google Stitch Extension

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

[Stitch](https://stitch.withgoogle.com) is Google's Gemini-powered AI platform that generates production-ready HTML/CSS UI designs from text prompts. This extension uses `@google/stitch-sdk` directly — no MCP proxy, no subprocess, no cold-start issues.

The extension registers **11 tools**: 8 SDK tools mapping to Stitch API operations, plus 3 virtual tools that fetch resolved content (HTML code, screenshots, multi-page sites).

## Prerequisites

### Authentication

Set one of these auth methods via environment variables:

**Option 1: API Key (simpler)**
```bash
export STITCH_API_KEY="your-api-key"
```

**Option 2: OAuth via gcloud (recommended for personal projects)**
```bash
export STITCH_ACCESS_TOKEN="$(gcloud auth application-default print-access-token)"
export GOOGLE_CLOUD_PROJECT="your-project-id"
```

### First-Time API Enablement

Enable the Stitch API on your Google Cloud project:
```bash
gcloud beta services mcp enable stitch.googleapis.com --project=YOUR_PROJECT_ID
```

### Verify Setup

```bash
# Quick check — should list your projects
stitch_list_projects
```

## Available Tools

### Project Management

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `stitch_create_project` | Create a new Stitch project | `title?: string` |
| `stitch_get_project` | Get project details by resource name | `name: string` — format: `projects/{id}` |
| `stitch_list_projects` | List all accessible projects | `filter?: string` — e.g. `view=owned`, `view=shared` |

### Screen Management

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `stitch_list_screens` | List all screens in a project | `projectId: string` |
| `stitch_get_screen` | Get screen details (includes download URLs) | `name: string`, `projectId: string`, `screenId: string` |

### AI Generation

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `stitch_generate_screen` | Generate a new screen from a text prompt | `projectId: string`, `prompt: string`, `deviceType?`, `modelId?` |
| `stitch_edit_screens` | Edit existing screens with a text prompt | `projectId: string`, `selectedScreenIds: string[]`, `prompt: string` |
| `stitch_generate_variants` | Generate design variants of screens | `projectId: string`, `selectedScreenIds: string[]`, `prompt: string`, `variantOptions: object` |

### Content Retrieval (Virtual Tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `stitch_get_screen_code` | Fetch resolved HTML code for a screen | `projectId: string`, `screenId: string` |
| `stitch_get_screen_image` | Fetch screenshot as base64 PNG | `projectId: string`, `screenId: string` |
| `stitch_build_site` | Build multi-page site from screen-to-route mapping | `projectId: string`, `routes: [{path, screenId}]` |

### Parameter Reference

**deviceType** (optional): `MOBILE`, `DESKTOP`, `TABLET`, `AGNOSTIC`, `DEVICE_TYPE_UNSPECIFIED`

**modelId** (optional): `GEMINI_3_PRO` (higher quality), `GEMINI_3_FLASH` (faster), `MODEL_ID_UNSPECIFIED`

**variantOptions** (for `stitch_generate_variants`):
- `variantCount?: number` — 1 to 5 (default: 3)
- `creativeRange?: string` — `REFINE`, `EXPLORE` (default), `REIMAGINE`
- `aspects?: string[]` — `LAYOUT`, `COLOR_SCHEME`, `IMAGES`, `TEXT_FONT`, `TEXT_CONTENT`

> **Important:** `stitch_generate_screen`, `stitch_edit_screens`, and `stitch_generate_variants` can take several minutes. Do **not** retry on timeout — check with `stitch_get_screen` afterward.

## Usage Examples

### List Your Projects

```
stitch_list_projects()
```

### Create a Project

```
stitch_create_project({ title: "My E-commerce App" })
```

### Generate a Screen from Text

```
stitch_generate_screen({
  projectId: "123456",
  prompt: "Modern login page with email/password fields, social login buttons, and forgot password link",
  deviceType: "MOBILE"
})
```

### Edit an Existing Screen

```
stitch_edit_screens({
  projectId: "123456",
  selectedScreenIds: ["screen-abc"],
  prompt: "Change the primary button color to blue and add a dark mode toggle"
})
```

### Generate Design Variants

```
stitch_generate_variants({
  projectId: "123456",
  selectedScreenIds: ["screen-abc"],
  prompt: "Create variations with different color schemes",
  variantOptions: {
    variantCount: 3,
    creativeRange: "EXPLORE",
    aspects: ["COLOR_SCHEME", "LAYOUT"]
  }
})
```

### Get Screen HTML Code

```
stitch_get_screen_code({ projectId: "123456", screenId: "screen-abc" })
```

Returns the actual HTML string — not just a download URL.

### Get Screen Screenshot

```
stitch_get_screen_image({ projectId: "123456", screenId: "screen-abc" })
```

Returns base64-encoded PNG data.

### Build a Multi-Page Site

```
stitch_build_site({
  projectId: "123456",
  routes: [
    { path: "/", screenId: "screen-home" },
    { path: "/about", screenId: "screen-about" },
    { path: "/dashboard", screenId: "screen-dashboard" }
  ]
})
```

## Workflow: Design → Code

1. **Browse projects** — `stitch_list_projects` → find your project ID
2. **List screens** — `stitch_list_screens` with `projectId` → see available screens
3. **Generate or pick a screen** — `stitch_generate_screen` or select existing
4. **Get the HTML** — `stitch_get_screen_code` → returns production-ready HTML/CSS
5. **Implement** — Convert the HTML into your framework (React, Next.js, etc.)

## Workflow: Build Full Site

1. **List screens** — `stitch_list_screens` to see all designs
2. **Map routes** — Decide which screen maps to which URL path
3. **Build** — `stitch_build_site` with route mappings → returns HTML for each page
4. **Deploy** — Output includes HTML for each route, ready for static hosting

## Troubleshooting

### "No auth configured"

Set either `STITCH_API_KEY` or both `STITCH_ACCESS_TOKEN` + `GOOGLE_CLOUD_PROJECT` as environment variables.

### "Authentication failed" / 401

- **API Key**: Verify `STITCH_API_KEY` is correct and the API is enabled
- **OAuth**: Token may have expired — refresh with `export STITCH_ACCESS_TOKEN="$(gcloud auth application-default print-access-token)"`

### "Stitch API not enabled"

```bash
gcloud beta services mcp enable stitch.googleapis.com --project=YOUR_PROJECT_ID
```

### "Generation timed out"

Generation can take several minutes. Don't retry — check with `stitch_get_screen` to see if it completed.

## Documentation

- [Google Stitch](https://stitch.withgoogle.com)
- [@google/stitch-sdk](https://github.com/google-labs-code/stitch-sdk)

## Tips

- Use descriptive, detailed prompts for better AI generation results
- `GEMINI_3_PRO` produces higher quality; `GEMINI_3_FLASH` is faster
- Set `deviceType` to match your target — `MOBILE`, `DESKTOP`, `TABLET`, or `AGNOSTIC`
- `stitch_get_screen_code` returns resolved HTML (not just a URL) — ready to use
- `stitch_build_site` maps screens to routes for a complete multi-page site
- The response from `stitch_generate_screen` may include suggestion fields — present these to the user
- The extension connects lazily — no startup delay when Stitch tools aren't used
