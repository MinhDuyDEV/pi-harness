---
name: code-navigation
description: Use when navigating unfamiliar code, tracing cross-file dependencies, or before editing — efficient code reading patterns that minimize tool calls and token waste
version: 1.0.0
tags: [workflow, code-quality, context]
dependencies: []
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

Start with search (grep, LSP findReferences) to locate, then read only what you need.

### Pattern 2: Multi-Symbol Search

When tracing a call chain (A calls B calls C), search for all symbols together:
```
grep({ pattern: "functionA|functionB|functionC", path: "src/" })
```

Or use LSP outgoingCalls to get the full call tree from a single point.

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
1. `lsp({ operation: "findReferences" })` — find all callers
2. `lsp({ operation: "incomingCalls" })` — get the call hierarchy
3. Review each caller to assess impact
4. Plan edits from leaf callers inward (furthest dependencies first)

### Pattern 5: Context Locality

When editing a file, search results from the same directory/package are more likely relevant. Pass context when available:
- In grep: use `path: "src/same-module/"` to scope
- In LSP: operations are already file-scoped
- In tilth: pass `context` param to boost nearby results

### Pattern 6: Outline Before Deep Read

For large files (>200 lines), get the structure first:
```
lsp({ operation: "documentSymbol", filePath: "src/large-file.ts", line: 1, character: 1 })
```

This gives you function names + line ranges. Then read only the section you need with `offset` and `limit`.

### Pattern 7: Follow the Call Chain (Not the File Tree)

**Wrong**: Read files top-to-bottom hoping to understand the flow.
**Right**: Start from the entry point, follow function calls:

```
1. lsp({ operation: "goToDefinition" })   → find where it's defined
2. lsp({ operation: "outgoingCalls" })     → what does it call?
3. lsp({ operation: "goToDefinition" })    → follow the interesting callee
```

## With tilth MCP

When tilth is available, it provides superior navigation:

| Built-in Tool | tilth Equivalent | Advantage |
|---|---|---|
| `grep` + `read` | `tilth_search` (expand: 2) | Returns definitions with inline source — no second read needed |
| `glob` | `tilth_files` | Adds token estimates per file |
| `read` (large file) | `tilth_read` | Auto-outlines large files, shows structure |
| `lsp(incomingCalls)` | `tilth_search(kind: "callers")` | Cross-language structural caller detection |
| Manual tracing | `tilth_deps` | Shows imports + downstream callers before breaking changes |

**IMPORTANT**: If tilth is available, prefer it over built-in grep/glob/read for code navigation. Tilth's expanded search results include full source — do NOT re-read files already shown in search output.

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
| Trace calls one-by-one | Multi-symbol search or outgoingCalls |
| Explore randomly | Start from entry point, follow calls |
| Forget to check blast radius | Always check before signature changes |
