---
description: Browse the web with Lightpanda headless browser via MCP. Fetch pages as markdown, extract links, evaluate JavaScript, get structured data. Use when the agent needs to read web pages, scrape content, or interact with web UIs without a full browser.
---

# Lightpanda Browser (MCP)

Lightpanda is a lightweight headless browser (Zig, ~22MB RAM, <100ms startup). Connected via MCP stdio.

## Available Tools

Access via `mcp({ tool: "lightpanda_<name>", args: '...', server: "lightpanda" })`.

| Tool | Purpose | Key Args |
|---|---|---|
| `lightpanda_goto` | Navigate to URL, load page in memory | `url` (required) |
| `lightpanda_markdown` | Page content as LLM-friendly markdown | `url` (optional) |
| `lightpanda_links` | Extract all links from page | `url` (optional) |
| `lightpanda_evaluate` | Execute JavaScript in page context | `script` (required), `url` (optional) |
| `lightpanda_semantic_tree` | Simplified DOM tree for AI reasoning | `url` (optional) |
| `lightpanda_interactiveElements` | Extract buttons, forms, inputs | `url` (optional) |
| `lightpanda_structuredData` | Extract JSON-LD, OpenGraph, meta | `url` (optional) |
| `lightpanda_get_page_html` | Raw HTML of current page | none |
| `lightpanda_get_page_markdown` | Markdown of current page (CDP path) | none |

Tools with optional `url` will navigate first if provided, otherwise reuse the current loaded page.

## Common Patterns

### Read a web page (most common)
```
mcp({ tool: "lightpanda_markdown", args: '{"url": "https://docs.example.com/api"}', server: "lightpanda" })
```

### Navigate once, extract multiple things
```
// Step 1: Load page
mcp({ tool: "lightpanda_goto", args: '{"url": "https://example.com"}', server: "lightpanda" })
// Step 2: Get content (reuses loaded page)
mcp({ tool: "lightpanda_markdown", server: "lightpanda" })
// Step 3: Get links
mcp({ tool: "lightpanda_links", server: "lightpanda" })
// Step 4: Get metadata
mcp({ tool: "lightpanda_structuredData", server: "lightpanda" })
```

### Execute JavaScript on a page
```
mcp({ tool: "lightpanda_evaluate", args: '{"url": "https://example.com", "script": "document.title"}', server: "lightpanda" })
```

## When to Use

| Scenario | Use Lightpanda | Use websearch/codesearch |
|---|---|---|
| Read specific docs page | Yes — full content | No — snippets only |
| Research a topic broadly | No | Yes — multiple results |
| Extract page structure/links | Yes | No |
| Run JS on a page | Yes | No |
| Get SEO/OpenGraph metadata | Yes | No |
| Need screenshots | No — no rendering | Use Playwright instead |

## Tool Priority (web content)

1. `websearch` / `codesearch` — broad research, multiple results
2. `lightpanda_markdown` — read a specific URL's full content
3. `playwright` — complex interactions, screenshots, SPAs

## Limitations

- No screenshots (no rendering engine — by design)
- No file uploads
- Some complex SPAs may not fully render (partial Web API support)
- No WebRTC, WebGL, Canvas, Web Workers
- Beta software (v0.2.x) — test critical pages first
