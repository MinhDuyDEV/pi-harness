---
name: tilth
description: >
  AST-aware code intelligence via tilth MCP server. Use when searching code for definitions,
  reading large files with structural outlines, finding files by glob, or checking blast radius
  before breaking changes. Replaces grep, cat, find, ls with tree-sitter powered equivalents.
  Reduces agent cost per correct answer by ~40%.
version: 1.0.0
tags: [code-intelligence, search, mcp, tools]
dependencies: []
references:
  - references/tools.md
  - references/patterns.md
---

# Tilth — Code Intelligence

Tree-sitter indexed code search and smart file reading. One tool replaces `grep`, `cat`,
`find`, `ls`, and `ast_grep`.

## When to Use

- Searching for symbol definitions, usages, or call sites in a codebase
- Reading large files that would consume too much context
- Finding files by glob pattern with token size estimates
- Checking blast radius before renaming/removing exports
- Any code navigation task — prefer tilth over built-in tools

## When NOT to Use

- Non-code files where tree-sitter has no grammar (use `read` directly)
- Simple one-off file reads of small known files

## Tools

The tilth extension registers these tools (proxied from the tilth MCP server):

| Tool | Replaces | Purpose |
|---|---|---|
| `tilth_search` | grep, rg, Grep | AST-aware symbol/content/regex/callers search |
| `tilth_read` | cat, Read | Smart file reading: full or structural outline |
| `tilth_files` | find, ls, Glob | Glob file finding with token estimates |
| `tilth_deps` | manual tracing | Blast-radius check before breaking changes |

See `references/tools.md` for full parameter documentation.

## Critical Rules

**DO NOT** use built-in `Read` if content is already shown in expanded search results.
**DO NOT** use `Grep`, `Read`, or `Glob` — always use `tilth_search`, `tilth_read`, `tilth_files`.
**DO NOT** re-read files already shown in expanded search results.

## Workflow

### Exploring Unknown Code

1. **Search first**: `tilth_search(query: "handleRequest")` — finds definitions + usages
2. **Drill in**: `tilth_read(path: "src/auth.ts", section: "44-89")` — exact lines
3. **Follow calls**: Expanded definitions show `── calls ──` footer with callees

### Before Breaking Changes

1. **Check blast radius**: `tilth_deps(path: "src/auth.ts")` — who imports this?
2. **Find callers**: `tilth_search(query: "handleAuth", kind: "callers")` — all call sites

### Multi-Symbol Tracing

```
tilth_search(query: "ServeHTTP, HandlersChain, Next", scope: ".")
```

Each symbol gets its own result block. Expand budget is shared across symbols.

## How File Reading Works

| File Size | Behavior |
|---|---|
| 0 bytes | `[empty]` |
| Binary | `[skipped]` with mime type |
| Generated (.min.js, lockfiles) | `[generated]` |
| < ~6000 tokens | Full content with line numbers |
| > ~6000 tokens | Structural outline with line ranges |

## Session Dedup

Previously expanded definitions show `[shown earlier]` instead of full body on subsequent
searches. Saves tokens when revisiting symbols.

## Search Output Format

```
## src/auth.ts:44-89 [definition]
  [24-42]  fn validateToken(token: string)
→ [44-89]  export fn handleAuth(req, res, next)
  [91-120] fn refreshSession(req, res)

  44 │ export function handleAuth(req, res, next) {
  ...
  89 │ }

── calls ──
  validateToken  src/auth.ts:24-42  fn validateToken(token: string): Claims | null
  refreshSession  src/auth.ts:91-120  fn refreshSession(req, res)
```

## Supported Languages (14)

Rust, TypeScript, TSX, JavaScript, Python, Go, Java, Scala, C, C++, Ruby, PHP, C#, Swift

## Installation

The tilth extension (`.pi/extensions/tilth.ts`) spawns tilth as a subprocess MCP server.
Requires `tilth` binary available via `npx tilth` or `cargo install tilth`.
