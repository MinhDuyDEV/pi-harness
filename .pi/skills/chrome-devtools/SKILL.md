---
name: chrome-devtools
description: Use when debugging web apps in Chrome — performance profiling, network inspection, DOM debugging, or console automation. MUST load before any Chrome DevTools-based debugging session.
version: 1.0.0
tags: [automation, debugging]
dependencies: []
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

```
# Get page structure with element UIDs
skill_mcp(skill_name="chrome-devtools", tool_name="take_snapshot")

# Navigate to URL
skill_mcp(skill_name="chrome-devtools", tool_name="navigate_page", arguments='{"type": "url", "url": "https://example.com"}')

# Click element (use UID from snapshot)
skill_mcp(skill_name="chrome-devtools", tool_name="click", arguments='{"uid": "e123"}')

# Fill input field
skill_mcp(skill_name="chrome-devtools", tool_name="fill", arguments='{"uid": "e456", "value": "hello"}')

# Take screenshot
skill_mcp(skill_name="chrome-devtools", tool_name="take_screenshot")
```

## Tips

- **Always `take_snapshot` first** to get element UIDs
- **Element UIDs change** after navigation - take fresh snapshot
- **Use `wait_for`** after actions that trigger page changes
- **Use `evaluate_script`** for custom JS when tools don't cover your need

## vs Playwright

| Feature             | chrome-devtools      | playwright         |
| ------------------- | -------------------- | ------------------ |
| Browser support     | Chrome only          | Chrome, FF, WebKit |
| Performance tracing | ✅ (full MCP has it) | ❌                 |
| Network inspection  | ✅ (full MCP has it) | ❌                 |
| Cross-browser       | ❌                   | ✅                 |

> **Note**: This skill loads 11 essential tools. For full 26+ tools (performance, network, console), modify `mcp.json` to remove `includeTools` filter.
