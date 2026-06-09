---
name: srcwalk
compatible_srcwalk: ">=1.0.0"
description: Use when navigating code with srcwalk — repo maps, large-file reads, symbol search, access evidence, callers/callees, context packets, impact checks, review packets, structural comparison, and precise drill-ins.
version: 3.0.0
tags: [code-intelligence, search, cli, srcwalk, git-review, comparison]
dependencies: []
agent_types: [planner, worker, reviewer, explorer]
tools: [bash, srcwalk_search, srcwalk_read, srcwalk_files, srcwalk_deps, srcwalk_map, srcwalk_callers, srcwalk_callees, srcwalk_context, srcwalk_impact, srcwalk_review, srcwalk_compare]
---

# Srcwalk — Code Navigation

Srcwalk is the project's code navigation engine (v1.0+). All Pi tools are backed by the installed `srcwalk` binary.

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
- Quick function orientation via context packets (Flow Maps)
- Heuristic impact triage
- Reviewing staged or commit-range changes via review packets
- Structural comparison of two code targets

## When NOT to Use

- Non-code files where tree-sitter has no grammar → use `read` directly
- Simple one-off reads of small known files → use built-in `read`

## Pi Tool Surface

### Core navigation tools

| Tool | Srcwalk command | Purpose |
|---|---|---|
| `srcwalk_search` | `srcwalk discover` | AST-aware multi-mode search: symbol definitions, usages, text, file, access evidence |
| `srcwalk_read` | `srcwalk <path>` | Smart file reading: outline or full with sections and context lines |
| `srcwalk_files` | `srcwalk discover --as file` | Glob file finding with token estimates, grouped by dir, multi-scope |
| `srcwalk_deps` | `srcwalk deps` | Blast-radius: dependency coupling, Markdown/HTML link extraction |

### Extended analysis tools

| Tool | Srcwalk command | Purpose |
|---|---|---|
| `srcwalk_map` | `srcwalk overview` | Token-annotated directory skeleton + dep groups + inline symbol anchors |
| `srcwalk_callers` | `srcwalk trace callers` | Reverse call graph with BFS depth + filters + aggregation |
| `srcwalk_callees` | `srcwalk trace callees` | Forward call graph with `--detailed` ordered call sites |
| `srcwalk_context` | `srcwalk context` | Flow Map packet: ordered callees, local resolves, callers, structured Flow Map |
| `srcwalk_impact` | `srcwalk assess` | Heuristic blast-radius triage |

### Git evidence & comparison tools

| Tool | Srcwalk command | Purpose |
|---|---|---|
| `srcwalk_review` | `srcwalk review` | Review Packet: staged or commit-range change evidence with Flow Maps |
| `srcwalk_compare` | `srcwalk compare` | Structural comparison of two code targets |

## Command Routing

| Intent | Use first |
|---|---|
| Understand repo shape | `srcwalk_map` |
| Read or inspect a large file | `srcwalk_read` |
| Jump to exact line | `srcwalk_read({ path: "file:42" })` |
| Read a line range | `srcwalk_read({ path: "file:44-89" })` |
| Read with context lines | `srcwalk_read({ section: "42", contextLines: 5 })` |
| Read by symbol name | `srcwalk_read({ section: "symbolName" })` |
| Multi-section read | `srcwalk_read({ section: "45-89, ## Config" })` |
| Find definition/usages/text/glob | `srcwalk_search` |
| Find files by glob | `srcwalk_files` |
| Multi-symbol search | `srcwalk_search({ query: "A, B, C" })` |
| Multi-scope search | `srcwalk_search({ query: "x", scopes: ["src", "tests"] })` |
| Exclude files from search | `srcwalk_search({ query: "x", exclude: "*test*" })` |
| Field/member access evidence | `srcwalk_search({ query: "x", asAccess: true })` |
| OR text search | `srcwalk_search({ query: "alloc, copy", matchMode: "any", scopes: ["src"] })` |
| Same-file co-occurrence | `srcwalk_search({ query: "alloc, copy", matchMode: "all", scopes: ["src"] })` |
| Who directly calls this? | `srcwalk_callers` |
| Who reaches this transitively? | `srcwalk_callers({ depth: 2 })` |
| What does this call? | `srcwalk_callees` |
| Ordered calls + arg slots | `srcwalk_callees({ detailed: true })` |
| Context packet (Flow Map) | `srcwalk_context` |
| File imports and dependents | `srcwalk_deps` |
| Heuristic blast-radius | `srcwalk_impact` (verify with callers) |
| Review staged changes | `srcwalk_review({ staged: true })` |
| Review commit range | `srcwalk_review({ base: "HEAD~2..HEAD" })` |
| Compare two functions/modules | `srcwalk_compare({ targetA: "a.ts:foo", targetB: "b.ts:bar" })` |

## Evidence Contract Routing

Prefer srcwalk tools over grep/rg/find for code navigation:

| Intent | Use first | Evidence contract |
|---|---|---|
| Search code | `srcwalk_search` | Prefer srcwalk before rg |
| Read files | `srcwalk_read` | Smart outlining, section drill |
| Find files | `srcwalk_files` | Prefer over find/ls |
| Call graphs | `srcwalk_callers` / `srcwalk_callees` | Verify call graphs with context reads |
| Orientation | `srcwalk_context` | First-pass before deep dives |
| Impact | `srcwalk_impact` | Triage first, then verify with callers |
| Dependencies | `srcwalk_deps` | Native dependency analysis |
| Review changes | `srcwalk_review` | Before commit or PR merge |
| Compare targets | `srcwalk_compare` | Structural diff of symbols/modules |

## Default Workflows

### Explore unfamiliar code

```
srcwalk_map({ scope: "." })
srcwalk_search({ query: "likely_symbol", scope: "src" })
srcwalk_read({ path: "src/file.ts:42" })         // jump to line
srcwalk_read({ path: "src/file.ts:44-89" })      // range shortcut
```

### Read a large file

```
srcwalk_read({ path: "src/file.ts" })                                    // structural outline
srcwalk_read({ path: "src/file.ts", section: "handleAuth" })             // drill into symbol
srcwalk_read({ path: "src/file.ts", section: "44-89" })                  // exact range
srcwalk_read({ path: "src/file.ts", section: "44-89", contextLines: 3 }) // range with context
srcwalk_read({ path: "src/file.ts", section: "45-89, ## Config" })       // comma-separated sections
```

Prefer outline/section reads before `full: true`.

### Find and drill into symbols

```
srcwalk_search({ query: "handleAuth", scope: "src" })
srcwalk_search({ query: "A, B, C", scope: "src" })                       // multi-symbol
srcwalk_search({ query: "handleAuth", expand: 2 })                        // inline source
srcwalk_search({ query: "handleAuth", scopes: ["src", "tests"] })        // multi-scope
srcwalk_search({ query: "handleAuth", exclude: "*test*" })               // exclude patterns
srcwalk_search({ query: "is_admin", asAccess: true })                     // field/member access
srcwalk_search({ query: "alloc, copy", matchMode: "any" })               // OR text search
srcwalk_search({ query: "alloc, copy", matchMode: "all" })               // co-occurrence
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

// context packet (flow map + neighborhood)
srcwalk_context({ target: "src/auth.ts:handleAuth" })                   // full packet
srcwalk_context({ symbol: "handleAuth", scope: "src" })                 // compact slice
```

Use `srcwalk_callers` for reverse call graph (single-hop by default, multi-hop with `depth`).

> Note: `--count-by` and `--depth` are mutually exclusive in `srcwalk_callers` — use one or the other, not both.

### Check file blast radius

```
srcwalk_deps({ path: "src/auth.ts" })
srcwalk_impact({ symbol: "handleAuth", scope: "src" })  // heuristic; follow up with callers
```

### Review & compare

```
// Git evidence
srcwalk_review({ staged: true })                                           // staged changes
srcwalk_review({ base: "HEAD~1..HEAD" })                                   // last commit
srcwalk_review({ base: "main..feature", scope: "src" })                    // branch diff scoped
srcwalk_review({ base: "HEAD~1..HEAD", budget: 1200 })                     // with budget cap

// Structural comparison
srcwalk_compare({ targetA: "src/auth.ts:validateToken", targetB: "src/auth.ts:validateSession" })
srcwalk_compare({ targetA: "src/old.ts:44-89", targetB: "src/new.ts:44-89" })
```

## Critical Rules

- **Do NOT** use built-in `read`/`grep`/`find` when srcwalk_* tools can answer
- **Do NOT** re-read files already shown in expanded `srcwalk_search` results
- `srcwalk_impact` is heuristic, not proof — verify with `srcwalk_callers` or exact reads
- `srcwalk_context` may collapse nested/fluent chains — drill with `{ detailed: true }` when inner calls matter
- Follow `> Next:` footers in output — they suggest the best next command
- Scope paths are **relative to Pi's CWD** (`.pi/` in this project). Use `scope: "extensions"` not `scope: ".pi/extensions"`
- `srcwalk_review({ staged: true })` checks `git diff --staged` — files must be staged first
- `srcwalk_compare` compares two known targets structurally, not at runtime — verify with reads if needed

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
