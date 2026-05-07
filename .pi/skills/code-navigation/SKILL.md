---
name: code-navigation
description: Use when navigating unfamiliar code, tracing cross-file dependencies, or before editing — efficient code reading patterns that minimize tool calls and token waste
version: 1.0.0
tags: [workflow, code-quality, context]
dependencies: []
agent_types: [planner, worker, reviewer]
tools: []
---

# Code Navigation Skill

## When to Use

- Exploring an unfamiliar codebase or module
- Tracing a function call across multiple files
- Understanding blast radius before a breaking change
- Planning edits that touch multiple files

## When NOT to Use

- Simple single-file edits where you already know the location
- Reading config or documentation files

## Core Principle

> Collapse multiple tool calls into fewer, smarter ones. Every unnecessary read or search wastes tokens and turns.

## Choose The Right Navigation Layer

- Use the `tilth` skill when you want project-stable Pi tools: `tilth_search`, `tilth_read`, `tilth_files`, `tilth_deps`
- Use the `srcwalk` skill when you need native CLI-only commands such as `srcwalk map`, `srcwalk callees`, `srcwalk flow`, `srcwalk impact`, or `srcwalk guide`
- Prefer `tilth` for existing project prompts and compatibility workflows; escalate to `srcwalk` for richer native analysis

## Navigation Patterns

### Pattern 1: Search First, Read Second

**Wrong** (3-6 tool calls):
```
glob("*.ts") → read(file1) → "too big" → grep("functionName") → read(file2) → read(file3, section)
```

**Right** (1-2 tool calls):
```
grep("functionName", path: "src/") → read(exact_file, offset: line-10, limit: 30)
```

Start with search (`tilth_search` or grep fallback) to locate, then read only what you need.

### Pattern 2: Multi-Symbol Search

When tracing a call chain (A calls B calls C), search for all symbols together:
```
grep({ pattern: "functionA|functionB|functionC", path: "src/" })
```

Or use `tilth_search(kind: "callers")` plus expanded definitions to trace the call tree.

### Pattern 3: Don't Re-Read What You've Already Seen

**Anti-pattern**: Search returns full function body, then agent reads the same file again.

If search results already show the code you need, work from that output. Only re-read when:
- You need surrounding context (lines above/below the match)
- You need the exact content for editing (verify before edit)
- The search result was truncated

### Pattern 4: Blast Radius Check (Before Breaking Changes)

**WHEN**: Before renaming, removing, or changing the signature of an export.
**SKIP**: When adding new code, fixing internal bugs, or reading.

Steps:
1. `tilth_deps(path: "src/file.ts")` — find importers and downstream users
2. `tilth_search(query: "symbolName", kind: "callers")` — find call sites
3. Review each caller to assess impact
4. Plan edits from leaf callers inward (furthest dependencies first)

### Pattern 5: Context Locality

When editing a file, search results from the same directory/package are more likely relevant. Pass context when available:
- In grep: use `path: "src/same-module/"` to scope
- In tilth: pass `context` param to boost nearby results

### Pattern 6: Outline Before Deep Read

For large files (>200 lines), get the structure first:
```
tilth_read(path: "src/large-file.ts")
```

This gives you structure and line ranges. Then read only the section you need.

### Pattern 7: Follow the Call Chain (Not the File Tree)

**Wrong**: Read files top-to-bottom hoping to understand the flow.
**Right**: Start from the entry point, follow function calls:

```
1. `tilth_search(query: "entryPoint")` → find where it is defined
2. Read expanded `── calls ──` output or use `tilth_search(kind: "callers")`
3. `tilth_read(section: "line-range")` → follow the interesting callee
```

## With tilth MCP Or Srcwalk Backend

When the `tilth_*` compatibility tools are available, they provide superior navigation for existing project workflows:

| Built-in Tool | tilth Equivalent | Advantage |
|---|---|---|
| `grep` + `read` | `tilth_search` (expand: 2) | Returns definitions with inline source — no second read needed |
| `glob` | `tilth_files` | Adds token estimates per file |
| `read` (large file) | `tilth_read` | Auto-outlines large files, shows structure |
| Manual caller grep | `tilth_search(kind: "callers")` | Cross-language structural caller detection |
| Manual tracing | `tilth_deps` | Shows imports + downstream callers before breaking changes |

**IMPORTANT**: If `tilth_*` tools are available, prefer them over built-in grep/glob/read for code navigation inside existing project workflows. Their expanded search results often include full source — do NOT re-read files already shown in search output.

If a task needs native srcwalk-only commands (`map`, `callees`, `flow`, `impact`, `guide`), load the `srcwalk` skill and use the installed CLI directly instead of trying to force that workflow through `tilth_*`.

## Cost Awareness

Every tool call has a token cost. Efficient navigation means:
- Fewer tool calls per task
- Less context consumed by redundant reads
- More budget available for actual implementation

**Target**: Find and understand any symbol in ≤3 tool calls, not 6+.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Read entire large file | Use outline first, then section read |
| Search → read same code again | Work from search results directly |
| Trace calls one-by-one | Multi-symbol search or `tilth_search(kind: "callers")` |
| Explore randomly | Start from entry point, follow calls |
| Forget to check blast radius | Always check before signature changes |
