---
name: stitch
description: Use when generating, editing, or creating variants of UI screens in Google Stitch. MUST load before any stitch_generate_screen or stitch_edit_screens tool calls.
version: 2.0.0
tags: [design, ui, stitch]
dependencies: []
---

# Google Stitch Plugin

## When to Use

- When you need to generate or inspect Google Stitch UI designs.

## When NOT to Use

- When you don't have Stitch access or don't need Stitch-generated UI.

## Overview

Stitch tools are registered as native OpenCode tools via the Stitch plugin (`.pi/plugin/stitch.ts`), using `@google/stitch-sdk` for direct HTTP to `stitch.googleapis.com/mcp`. No MCP subprocess needed.

## Prerequisites

1. **Google Cloud Project** with Stitch API enabled
2. **Google Cloud CLI** (`gcloud`) installed and initialized
3. **Required IAM Roles**:
   - `roles/serviceusage.serviceUsageAdmin` (to enable the service)
   - `roles/mcp.toolUser` (to call MCP tools)

## Setup Steps

### 1. Enable Stitch API in Google Cloud

```bash
gcloud config set project PROJECT_ID
gcloud beta services mcp enable stitch.googleapis.com --project=PROJECT_ID
```

### 2. Set Environment Variables

**API Key auth** (recommended):

```bash
export STITCH_API_KEY="your-api-key"
```

**Or OAuth auth**:

```bash
export STITCH_ACCESS_TOKEN=$(gcloud auth print-access-token)
export GOOGLE_CLOUD_PROJECT="your-project-id"
```

### 3. Restart OpenCode

Tools are available immediately after env vars are set and OpenCode restarts.

## Available Tools

| Tool                       | Description                          |
| -------------------------- | ------------------------------------ |
| `stitch_create_project`    | Create a new Stitch project          |
| `stitch_get_project`       | Get project details by resource name |
| `stitch_list_projects`     | List all projects (optional filter)  |
| `stitch_list_screens`      | List screens in a project            |
| `stitch_get_screen`        | Get screen details with HTML code    |
| `stitch_generate_screen`   | Generate UI from text prompt         |
| `stitch_edit_screens`      | Edit existing screens with a prompt  |
| `stitch_generate_variants` | Generate design variants of screens  |

## Usage Examples

### List Projects

```typescript
stitch_list_projects({});
```

### Create a Project

```typescript
stitch_create_project({ title: "My E-commerce App" });
```

### Generate Screen from Text

```typescript
stitch_generate_screen({
  projectId: "my-project-123",
  prompt:
    "Create a modern login page with email and password fields, social login buttons, and a forgot password link",
  deviceType: "MOBILE",
});
```

### Edit Existing Screens

```typescript
stitch_edit_screens({
  projectId: "my-project-123",
  selectedScreenIds: ["screen-abc"],
  prompt: "Make the login button larger and change the color scheme to dark mode",
});
```

### Generate Design Variants

```typescript
stitch_generate_variants({
  projectId: "my-project-123",
  selectedScreenIds: ["screen-abc"],
  prompt: "Create variants with different color schemes",
  variantCount: 3,
  creativeRange: "MEDIUM",
});
```

## Parameters

### Device Types

`DEVICE_TYPE_UNSPECIFIED` | `MOBILE` | `DESKTOP` | `TABLET` | `AGNOSTIC`

### Model IDs

`MODEL_ID_UNSPECIFIED` | `GEMINI_3_PRO` | `GEMINI_3_FLASH`

### Variant Options

- `variantCount`: Number of variants (1-10)
- `creativeRange`: `LOW` | `MEDIUM` | `HIGH`
- `aspects`: Comma-separated aspects to vary (e.g. "color,layout")

## Troubleshooting

### "AUTH_FAILED"

```bash
# API key auth
export STITCH_API_KEY="your-key"

# Or OAuth (token expires after ~1 hour)
export STITCH_ACCESS_TOKEN=$(gcloud auth print-access-token)
```

### "Stitch API not enabled"

```bash
gcloud beta services mcp enable stitch.googleapis.com --project=YOUR_PROJECT_ID
```

## Documentation

- [Google Stitch](https://stitch.withgoogle.com)
- [Stitch SDK](https://github.com/google-labs-code/stitch-sdk)
- [Stitch MCP Setup](https://stitch.withgoogle.com/docs/mcp/setup)

## Tips

- API key auth is simpler than OAuth (no token refresh)
- Use descriptive prompts for better UI generation
- `GEMINI_3_PRO` produces higher quality; `GEMINI_3_FLASH` is faster
- Test generated code in your target framework before production use
