---
name: webclaw
description: MUST load when webfetch returns 403 or bot protection errors, when crawling documentation sites, batch-extracting pages, or extracting brand identity. Primary web scraping tool — prefer over webfetch for all non-trivial scraping.
---

# Webclaw Skill

Fast, local-first web content extraction for LLMs. Rust-based scraper with TLS fingerprinting, 67% token reduction, and native MCP integration.

## Prerequisites

- `webclaw-mcp` binary installed at `~/.webclaw/webclaw-mcp`
- Install: `brew tap 0xMassi/webclaw && brew install webclaw`
- Or: download from https://github.com/0xMassi/webclaw/releases
- MCP server must be enabled in `.opencode/opencode.json` (`"enabled": true`)

## When to Use

| Scenario               | Tool                   | Why                                        |
| ---------------------- | ---------------------- | ------------------------------------------ |
| `webfetch` got 403     | `scrape`               | TLS fingerprinting bypasses bot protection |
| Research a doc site    | `crawl`                | BFS recursive extraction, same-origin      |
| Extract multiple URLs  | `batch`                | Parallel multi-URL, faster than sequential |
| Discover sitemap URLs  | `map`                  | Find all pages without crawling            |
| Track doc changes      | `diff`                 | Snapshot + compare workflow                |
| Extract brand identity | `brand`                | Colors, fonts, logos from any site         |
| LLM-optimized output   | `scrape` with `-f llm` | 67% fewer tokens than raw HTML             |

## MCP Tools (8 local, no API key needed)

### scrape

Extract clean content from a URL. Returns markdown, text, JSON, or LLM-optimized format.

```
scrape(url: "https://example.com", format: "llm")
```

Options: `format` (markdown|text|json|llm|html), `include` (CSS selectors), `exclude` (CSS selectors), `only_main_content` (boolean)

### crawl

Recursive BFS crawl of a site. Same-origin only.

```
crawl(url: "https://docs.example.com", depth: 2, max_pages: 50)
```

Options: `depth` (1-10), `max_pages`, `sitemap` (seed from sitemap.xml)

### map

Discover URLs from a site's sitemap without fetching content.

```
map(url: "https://docs.example.com")
```

### batch

Parallel extraction from multiple URLs.

```
batch(urls: ["https://a.com", "https://b.com"], format: "llm")
```

### diff

Compare current page content against a previous snapshot.

```
diff(url: "https://example.com", snapshot: previous_json)
```

### brand

Extract visual identity: colors, fonts, logos, OG image.

```
brand(url: "https://stripe.com")
```

Returns: `{ name, colors: [{hex, usage}], fonts: [], logos: [{url, kind}] }`

### extract (needs Ollama)

LLM-powered structured extraction. Requires local Ollama instance.

### summarize (needs Ollama)

Page summarization via local LLM.

## Workflow Patterns

### Fallback when webfetch fails

1. Try `webfetch` first (built-in, no setup)
2. If 403 or empty → use `scrape` via webclaw MCP
3. If JS-rendered SPA → note limitation (webclaw doesn't execute JS without cloud API)

### Research a documentation site

1. `map(url)` to discover all pages
2. `crawl(url, depth: 2, max_pages: 50)` to extract content
3. Feed results to analysis agent

### Brand/design audit

1. `brand(url)` to extract colors, fonts, logos
2. Pass to vision agent for design system analysis

### Track changes over time

1. `scrape(url, format: "json")` → save as snapshot
2. Later: `diff(url, snapshot: saved)` → see what changed

## Installation

```bash
# Homebrew (recommended)
brew tap 0xMassi/webclaw
brew install webclaw

# Prebuilt binary
# Download from https://github.com/0xMassi/webclaw/releases
# Place webclaw-mcp in ~/.webclaw/

# Verify
webclaw-mcp --version
```

## Configuration

After install, enable in `.opencode/opencode.json`:

```json
{
  "mcp": {
    "webclaw": {
      "enabled": true
    }
  }
}
```

Optional env vars:

- `WEBCLAW_API_KEY` — cloud API for bot-protected sites (optional)
- `OLLAMA_HOST` — for extract/summarize tools (default: `http://localhost:11434`)

## Limitations

- **No JS rendering** (local mode) — SPAs that render entirely client-side won't extract fully. Use `--cloud` with API key, or use `playwright` skill instead.
- **Same-origin crawl only** — won't follow external links during crawl.
- **Early version** — v0.3.2, MIT license. Report issues to https://github.com/0xMassi/webclaw/issues
