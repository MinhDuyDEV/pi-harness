---
name: chrome-devtools
description: >-
  Drives a live Chrome page over the DevTools Protocol via the chrome-devtools MCP server — snapshot,
  click, fill, evaluate_script, screenshots. User-invoked: load via /skill:chrome-devtools when
  debugging or inspecting a live Chrome session; prefer the playwright skill for cross-browser or
  repeatable scripted automation.
metadata:
  version: 1.0.0
  tags:
  - automation
  - debugging
  dependencies: []
disable-model-invocation: true
---

# Chrome DevTools (MCP)

## When to Use

- When you need to debug or inspect a live Chrome page via DevTools Protocol tools.

## When NOT to Use

- When cross-browser automation is required (use Playwright-based skills instead).


## Available Tools

- `take_snapshot` - Get accessibility tree snapshot with element UIDs
- `take_screenshot` - Capture screenshot of page or element
- `navigate_page` - Navigate to URL, back, forward, or reload
- `new_page` - Open a new browser tab
- `list_pages` - List all open pages/tabs
- `click` - Click element by UID
- `fill` - Type text into element
- `hover` - Hover over element
- `press_key` - Press keyboard key (Enter, Tab, etc.)
- `evaluate_script` - Run JavaScript in page context
- `wait_for` - Wait for text to appear

## Workflow

1. **Snapshot** the page using `take_snapshot` to get element UIDs
2. **Navigate** to target URL using `navigate_page`
3. **Interact** using `click`, `fill`, `hover` with UIDs from snapshot
4. **Screenshot** to capture results using `take_screenshot`

## Quick Start

Typical call sequence (arguments shown as JSON):

```
take_snapshot                                              # page structure with element UIDs
navigate_page   {"type": "url", "url": "https://example.com"}
click           {"uid": "e123"}                            # UID from the snapshot
fill            {"uid": "e456", "value": "hello"}
take_screenshot
```

See `mcp.json` in this skill's directory for the server command (`chrome-devtools-mcp`) and the `includeTools` filter.

## Tips

- **Always `take_snapshot` first** to get element UIDs
- **Element UIDs change** after navigation - take fresh snapshot
- **Use `wait_for`** after actions that trigger page changes
- **Use `evaluate_script`** for custom JS when tools don't cover your need

## vs Playwright

| Feature | chrome-devtools | playwright |
| --- | --- | --- |
| Browser support | Chrome only | Chromium, Firefox, WebKit |
| Best for | Live inspection of a running Chrome session | Repeatable scripted flows, cross-browser tests |
| Network inspection / tracing | Yes (full MCP toolset) | Yes (request interception, trace viewer) |

Both cover network inspection and tracing — choose by workflow, not by feature: ad-hoc debugging here, durable automation in `playwright`.

> **Note**: This skill loads 11 essential tools. For the full 26+ tools (performance, network, console), modify `mcp.json` to remove the `includeTools` filter.
