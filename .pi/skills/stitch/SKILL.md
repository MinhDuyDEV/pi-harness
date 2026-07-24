---
name: stitch
description: Use when generating, editing, or creating variants of UI screens in Google Stitch. MUST load before any stitch_generate_screen
  or stitch_edit_screens tool calls.
metadata:
  version: 2.0.0
  tags:
  - design
  - ui
  - stitch
  dependencies: []
disable-model-invocation: true
---

# Google Stitch Plugin

## When to Use

Generating or inspecting Google Stitch UI designs; creating screen variants; editing existing Stitch screens.

## When NOT to Use

No Stitch access; no Stitch-generated UI needed.

## Overview

Stitch tools are native OpenCode tools via the Stitch plugin (`.pi/plugin/stitch.ts`), using `@google/stitch-sdk` for direct HTTP to `stitch.googleapis.com/mcp`. No MCP subprocess.

## Prerequisites

1. **Google Cloud Project** with Stitch API enabled
2. **Google Cloud CLI** (`gcloud`) installed and initialized
3. **Required IAM Roles**: `roles/serviceusage.serviceUsageAdmin` (to enable the service)

## Key Operations

| Action | Tool |
|---|---|
| Generate a screen | `stitch_generate_screen(prompt, brand?, styles?)` |
| Edit an existing screen | `stitch_edit_screens(screenIds, prompt)` |
| Get screen details | `stitch_get_screen(screenId)` |

## Workflow

1. **Generate a screen.** Describe the screen in a prompt. Include brand guidelines or a style reference.
2. **Inspect the result.** Check if the output matches the design spec (see `mockup-to-code`).
3. **Edit if needed.** Use `stitch_edit_screens` for targeted changes.
4. **Export.** Stitch screens are exported as code or image assets depending on the target platform.

## Workflow (continued)

For iterative design: generate → inspect → edit → regenerate until it's right.

## Common Mistakes

Loading Stitch without a design task; generating without a specific prompt; "just generate something" (waste of tokens); not editing after generation; assuming the first output is final; not inspecting the result before committing; mixing Stitch and hand-written code without coordination.

## Red Flags

Stitch loaded for non-UI tasks; generation without specific prompt; first output accepted as final; no inspection of generated output; mixing Stitch and hand-written code without plan; "just make something" prompt.

## Anti-Patterns

**Stitch for non-UI**; **no prompt**; **first output = final**; **no inspection**; **no coordination with hand-written code**.
