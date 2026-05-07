---
name: tilth
description: Use when navigating code with tree-sitter indexed search, smart file reads, symbol lookup, caller tracing, or blast-radius checks before edits.
version: 1.1.0
tags: [code-intelligence, search, mcp, tools, srcwalk]
dependencies: []
agent_types: [planner, worker, reviewer]
tools: []
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

The tilth extension registers these public tools via a compatibility layer. By default they use the tilth MCP backend, and they can optionally use a srcwalk CLI backend when `PI_CODE_NAV_BACKEND=srcwalk`.

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

The tilth extension (`.pi/extensions/tilth.ts`) preserves the `tilth_*` tool contract while selecting a backend at runtime:

- default: tilth MCP via `npx tilth --mcp`
- optional: srcwalk CLI via `PI_CODE_NAV_BACKEND=srcwalk`

Working setups:

### Default tilth backend

Requires `tilth` available via `npx tilth` or `cargo install tilth`.

### Optional srcwalk backend

Requires `srcwalk` available on `PATH` or `PI_SRCWALK_BIN` set to the binary path.
Most reliable setup:

```sh
export PI_CODE_NAV_BACKEND=srcwalk
export PI_SRCWALK_BIN="$HOME/.cargo/bin/srcwalk"
```

If you prefer `$(command -v srcwalk)`, make sure your `PATH` is finalized first and that it resolves to the real binary you want, not a stale wrapper.

## Native Srcwalk Escalation

If you need native srcwalk-only commands such as `srcwalk map`, `srcwalk callees`, `srcwalk flow`, `srcwalk impact`, or `srcwalk guide`, load the separate `srcwalk` skill instead of stretching this compatibility layer beyond its intended surface.

## Current srcwalk Compatibility Notes

When the srcwalk backend is active:

- `tilth_search` maps `kind: "callers"` to `srcwalk callers`; other search kinds map to `srcwalk find`
- `tilth_read(path)` maps to `srcwalk <path>` with optional `--section`, `--full`, and `--budget`
- `tilth_read(paths[])` is emulated by the wrapper and concatenated with separators
- `tilth_files` maps to `srcwalk files`
- `tilth_deps` runs an exact relative-import scan first, then appends `srcwalk deps` heuristic symbol/dependency output
- `context` in `tilth_search` is currently accepted but ignored because srcwalk has no matching public CLI flag
- output shape may differ slightly from the tilth MCP backend

Do not claim full tilth platform parity from this mode: MCP/edit/diff behavior is not provided by srcwalk in this compatibility layer.


## Consolidated CLI And Subagent Mode

`tilth-cli` was removed as a separate optional skill. Keep tree-sitter search, smart reads, symbol/caller tracing, blast-radius checks, and subagent CLI usage in this canonical Tilth workflow.
