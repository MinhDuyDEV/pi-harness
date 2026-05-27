---
name: srcwalk
compatible_srcwalk: ">=1.0.0"
description: Use when navigating code with srcwalk — repo maps, large-file reads, symbol search, callers/callees, flow slices, impact checks, and precise drill-ins.
version: 2.1.0
tags: [code-intelligence, search, cli, srcwalk]
dependencies: []
agent_types: [planner, worker, reviewer, explorer]
tools: [bash, srcwalk_search, srcwalk_read, srcwalk_files, srcwalk_deps, srcwalk_map, srcwalk_callers, srcwalk_callees, srcwalk_flow, srcwalk_impact]
---

# Srcwalk — Code Navigation

Srcwalk is the project's code navigation engine (v1.0.1+). All Pi tools are backed by the installed `srcwalk` binary.

Run the embedded guide before non-trivial use — it is the version-matched source of truth:

```bash
srcwalk guide
```

Do not pipe, truncate, or summarize `srcwalk guide`.

## When to Use

- Any code navigation task: symbol search, large-file reading, repo maps
- Tracing call graphs (callers, callees, transitive chains)
- Checking blast radius before breaking changes
- Understanding repo shape and token budgets
- Quick function orientation (flow slice)
- Heuristic impact triage

## When NOT to Use

- Non-code files where tree-sitter has no grammar → use `read` directly
- Simple one-off reads of small known files → use built-in `read`

## Pi Tool Surface

### Core navigation tools

| Tool | Srcwalk command | Purpose |
|---|---|---|
| `srcwalk_search` | `srcwalk discover` / `srcwalk trace callers` | AST-aware symbol/content/regex/callers search |
| `srcwalk_read` | `srcwalk <path>` | Smart file reading: outline or full with sections |
| `srcwalk_files` | `srcwalk discover --as file` | Glob file finding with token estimates, grouped by dir |
| `srcwalk_deps` | `srcwalk deps` | Blast-radius: dependency analysis (v1.0.1) |

### Extended analysis tools

| Tool | Srcwalk command | Purpose |
|---|---|---|
| `srcwalk_map` | `srcwalk overview` | Token-annotated directory skeleton + dep groups + inline symbol anchors (v1.0.1) |
| `srcwalk_callers` | `srcwalk trace callers` | Reverse call graph with BFS depth + filters |
| `srcwalk_callees` | `srcwalk trace callees` | Forward call graph with `--detailed` ordered call sites |
| `srcwalk_flow` | `srcwalk context` | Compact orientation slice |
| `srcwalk_impact` | `srcwalk assess` | Heuristic blast-radius triage |

## Command Routing

| Intent | Use first |
|---|---|
| Understand repo shape | `srcwalk_map` |
| Read or inspect a large file | `srcwalk_read` |
| Jump to exact line | `srcwalk_read({ path: "file:42" })` |
| Read a line range | `srcwalk_read({ path: "file:44-89" })` — v1.0.0 shortcut |
| Read with context lines | `srcwalk_read({ section: "42", contextLines: 5 })` — v1.0.1 |
| Read by symbol name | `srcwalk_read({ section: "symbolName" })` |
| Multi-section read | `srcwalk_read({ section: "45-89, ## Config" })` — v1.0.1 comma-separated |
| Find definition/usages/text/glob | `srcwalk_search` |
| Find files by glob | `srcwalk_files` |
| Multi-symbol search | `srcwalk_search({ query: "A, B, C" })` |
| Who directly calls this? | `srcwalk_callers` |
| Who reaches this transitively? | `srcwalk_callers({ depth: 2 })` |
| What does this call? | `srcwalk_callees` |
| Ordered calls + arg slots | `srcwalk_callees({ detailed: true })` |
| Quick orientation slice | `srcwalk_flow` |
| File imports and dependents | `srcwalk_deps` |
| Heuristic blast-radius | `srcwalk_impact` (verify with callers) |

## Evidence Contract Routing

Srcwalk v1.0.1 establishes an **evidence contract** — prefer srcwalk tools over grep/rg for code navigation:

| Intent | Use first | Evidence contract |
|---|---|---|
| Search code | `srcwalk_search` | Prefer srcwalk before rg |
| Read files | `srcwalk_read` | Smart outlining, section drill |
| Find files | `srcwalk_files` | Prefer over find/ls |
| Call graphs | `srcwalk_callers` / `srcwalk_callees` | Verify call graphs with context reads |
| Orientation | `srcwalk_flow` | First-pass before deep dives |
| Impact | `srcwalk_impact` | Triage first, then verify with callers |
| Dependencies | `srcwalk_deps` | Native dependency analysis |

## Default Workflows

### Explore unfamiliar code

```
srcwalk_map({ scope: "." })
srcwalk_search({ query: "likely_symbol", scope: "src" })
srcwalk_read({ path: "src/file.ts:42" })         // jump to line
srcwalk_read({ path: "src/file.ts:44-89" })      // range shortcut (v1.0.0)
```

### Read a large file

```
srcwalk_read({ path: "src/file.ts" })                                    // structural outline
srcwalk_read({ path: "src/file.ts", section: "handleAuth" })             // drill into symbol
srcwalk_read({ path: "src/file.ts", section: "44-89" })                  // exact range
srcwalk_read({ path: "src/file.ts", section: "44-89", contextLines: 3 }) // range with context (v1.0.1)
srcwalk_read({ path: "src/file.ts", section: "45-89, ## Config" })       // comma-separated sections (v1.0.1)
```

Prefer outline/section reads before `full: true`.

### Find and drill into symbols

```
srcwalk_search({ query: "handleAuth", scope: "src" })
srcwalk_search({ query: "A, B, C", scope: "src" })           // multi-symbol
srcwalk_search({ query: "handleAuth", expand: 2 })            // inline source
```

### Trace call graph

```
// upstream
srcwalk_callers({ symbol: "handleAuth", scope: "src" })
srcwalk_callers({ symbol: "handleAuth", depth: 2, scope: "src" })      // transitive
srcwalk_callers({ symbol: "handleAuth", filter: "args:3", scope: "src" })
srcwalk_callers({ symbol: "handleAuth", countBy: "file", scope: "src" })

// downstream
srcwalk_callees({ symbol: "handleAuth", scope: "src" })
srcwalk_callees({ symbol: "handleAuth", detailed: true, scope: "src" }) // ordered sites
srcwalk_callees({ symbol: "handleAuth", depth: 2, scope: "src" })       // transitive

// quick orientation
srcwalk_flow({ symbol: "handleAuth", scope: "src" })
```

Use `srcwalk_search({ kind: "callers" })` for quick single-hop. Use `srcwalk_callers` when you need depth, filters, or aggregation.

> Note: `--count-by` and `--depth` are mutually exclusive in `srcwalk_callers` — use one or the other, not both.

### Check file blast radius

```
srcwalk_deps({ path: "src/auth.ts" })
srcwalk_impact({ symbol: "handleAuth", scope: "src" })  // heuristic; follow up with callers
```

## v1.0.1 Features

- **Context lines**: `srcwalk_read` now supports `contextLines` parameter (like `grep -C`). Pass `contextLines: 3` to show context around matched sections.
- **Comma-separated sections**: `srcwalk_read` supports comma-separated section targets, e.g. `section: "45-89, ## Config"`. Multi-reads clamp each target to 10 context lines.
- **Budget-adaptive symbol anchors**: `srcwalk_map` now supports `symbols: true` to emit inline `kind name@line-range` anchors in directory overviews.
- **Evidence contract**: All tools now have evidence contract guidance in their descriptions — prefer srcwalk over grep/rg/find for code navigation.
- **Enhanced dependency analysis**: `srcwalk_deps` now uses purely native analysis (simplified, no custom JS import scanning).
- **Improved discover guidance**: Next-step footers prefer confirmed `context` targets and suggest raw reads with `-C 10` for text hits.

### Migration from v1.0.0

No breaking changes. All v1.0.0 workflows continue to work. New features are additive:

## Critical Rules

- **Do NOT** use built-in `read`/`grep`/`find` when srcwalk_* tools can answer
- **Do NOT** re-read files already shown in expanded `srcwalk_search` results
- `srcwalk_impact` is heuristic, not proof — verify with `srcwalk_callers` or exact reads
- `srcwalk_flow` may collapse nested/fluent chains — drill with `srcwalk_callees({ detailed: true })` when inner calls matter
- Follow `> Next:` footers in output — they suggest the best next command
- Scope paths are **relative to Pi's CWD** (`.pi/` in this project). Use `scope: "extensions"` not `scope: ".pi/extensions"`

## Supported Languages

Rust, TypeScript, TSX, JavaScript, Python, Go, Java, Scala, C, C++, Ruby, PHP, C#, Swift, Elixir, Kotlin. Unsupported files still get smart text/outline reads.

## Setup

```sh
# verify binary and version
srcwalk guide

# install / upgrade
npm install -g srcwalk          # npm
cargo install srcwalk --locked  # crates.io

# custom binary path if not on PATH
export PI_SRCWALK_BIN="$HOME/.cargo/bin/srcwalk"
```

## CWD Note

All scope paths are relative to the **current working directory** when Pi is running. In pikit, CWD is `.pi/`, so:

```
srcwalk_callers({ symbol: "foo", scope: "extensions" })      // ✓
srcwalk_callers({ symbol: "foo", scope: ".pi/extensions" })  // ✗ resolves to .pi/.pi/extensions
```

Use absolute paths when crossing directories.
