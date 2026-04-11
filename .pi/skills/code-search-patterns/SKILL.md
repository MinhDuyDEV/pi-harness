---
name: code-search-patterns
description: Use when navigating unfamiliar code with search-first patterns, combining built-in/LSP navigation with tilth MCP (main agent) and tilth CLI (subagents)
version: 1.0.0
tags: [workflow, code-quality, context, subagent]
dependencies: []
---

# Code Search Patterns

Unified navigation skill for fast, low-waste code understanding across both execution modes:

- **Main agent**: built-in tools + LSP + tilth MCP
- **Subagents**: Bash + `npx -y tilth` CLI

This skill merges practical navigation heuristics with concrete tool usage so you can locate behavior, trace impact, and edit safely with fewer calls.

## When to Use

- Exploring unfamiliar modules before editing
- Tracing call chains across files and directories
- Checking blast radius before signature/export changes
- Dispatching subagents that need structural code navigation
- Reducing token/tool-call waste during implementation

## When NOT to Use

- Trivial single-file edits where symbol location is already known
- Pure docs/config reads with no dependency tracing
- Tasks focused on external web research (use web research tools instead)

## Core Principle

> Collapse multiple tool calls into fewer, smarter ones. Every unnecessary read or search wastes tokens and turns.

## Navigation Patterns

### 1) Search First, Read Second

Start with symbol/content search to find exact locations, then read only the needed slice.

- **Good**: `search -> targeted read`
- **Avoid**: `read many files -> search later`

Use LSP (`findReferences`, `outgoingCalls`) or tilth search first; read deep only after narrowing scope.

### 2) Multi-Symbol Search

When flow spans multiple functions, query them together (`A,B,C`) instead of serial one-by-one lookups.

- Faster call-chain reconstruction
- Fewer repeated scans of the same files

### 3) Don’t Re-Read What Search Already Returned

If search output already includes definition body/context, proceed from it.
Re-read only when you need:

- exact edit anchors,
- additional surrounding lines,
- or untruncated content.

### 4) Blast Radius Check (Before Breaking Changes)

Before renaming/removing/changing signatures, inspect downstream impact first.

- LSP: `findReferences`, `incomingCalls`
- tilth: `tilth_tilth_deps` or `--deps`

Then apply edits from dependents inward.

### 5) Context Locality

Prefer nearby package/module scope first.

- built-in search: constrain `path`
- tilth: pass `scope` / `context`

Locality reduces irrelevant matches and token churn.

### 6) Outline Before Deep Read

For large files, inspect structure first (symbols/outline), then read only target sections.

- LSP: `documentSymbol`
- tilth read: smart outline by default, then section drill-in

### 7) Follow Call Chain, Not File Tree

Start at entry behavior and walk calls (`definition -> outgoing -> next definition`) instead of reading folders linearly.

This exposes real execution flow with fewer reads.

## tilth MCP (Main Agent)

Use MCP variants when available in the main agent session:

- `tilth_tilth_search`
- `tilth_tilth_read`
- `tilth_tilth_files`
- `tilth_tilth_deps`

### Built-in/LSP vs tilth MCP (when to choose which)

| Need                    | Built-in / LSP                         | Prefer tilth MCP when                                       | Why tilth helps                     |
| ----------------------- | -------------------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| Find symbols/usages     | `grep` / `lsp.findReferences`          | You want definitions + usages + expanded source in one call | Reduces search+read round trips     |
| Read file content       | `read`                                 | File is large or you only need structure first              | Smart outline + section targeting   |
| List candidate files    | `glob`                                 | You want quick glob results with token-aware relevance      | Faster triage for large directories |
| Pre-change impact check | `lsp.incomingCalls` + manual follow-up | You need import + dependent view before breaking change     | Single blast-radius view via deps   |

Guideline: if tilth MCP is active, use it as default for navigation; fall back to built-in/LSP when you need language-server-specific semantics or exact editor-position operations.

## tilth CLI (Subagents)

### Why this exists

Subagents typically cannot call MCP tools directly. They can still use tilth through Bash:

```bash
npx -y tilth <query> [flags]
```

### Auto-detection

| Query shape                       | Auto-detected action                 |
| --------------------------------- | ------------------------------------ |
| Existing file path (`src/foo.ts`) | Read file (smart outline/full)       |
| Identifier (`initCommand`)        | Symbol search (definitions + usages) |
| Glob (`*.test.ts`)                | List files                           |
| Plain text / phrase               | Content search                       |

Use `--kind` to force a specific mode when needed.

### Core operations

#### 1) Read file

```bash
npx -y tilth src/index.ts
npx -y tilth src/index.ts --full
npx -y tilth src/index.ts --section 45-89
```

#### 2) Search symbols

```bash
npx -y tilth initCommand --scope src/
npx -y tilth "initCommand,detectMode" --scope src/
```

#### 3) Search text/regex

```bash
npx -y tilth --kind content "TODO" --scope src/
npx -y tilth --kind regex "/TODO.*fix/" --scope src/
```

#### 4) Find callers

```bash
npx -y tilth --kind callers initCommand --scope src/
```

#### 5) List files

```bash
npx -y tilth "*.test.ts" --scope src/
```

#### 6) Blast radius / deps

```bash
npx -y tilth --deps src/commands/init.ts --scope src/
```

#### 7) Codebase map

```bash
npx -y tilth --map --scope src/
```

### Useful flags

| Flag              | Purpose                        | Example                      |
| ----------------- | ------------------------------ | ---------------------------- | ------------------- | ----------------- | ---------------- |
| `--scope <dir>`   | Restrict scan area             | `--scope src/commands/`      |
| `--section <range | heading>`                      | Targeted file slice          | `--section 120-180` |
| `--full`          | Force full file output         | `--full`                     |
| `--budget <n>`    | Limit output size              | `--budget 2000`              |
| `--json`          | Machine-readable output        | `--json`                     |
| `--map`           | Structural project skeleton    | `--map --scope src/`         |
| `--kind <symbol   | content                        | regex                        | callers>`           | Force search mode | `--kind callers` |
| `--deps <file>`   | Import/dependent blast radius  | `--deps src/utils/errors.ts` |
| `--expand <n>`    | Expand top matches with source | `--expand 3`                 |

### MCP vs CLI

| Capability                   | MCP (main agent)                                   | CLI (subagents)                            |
| ---------------------------- | -------------------------------------------------- | ------------------------------------------ |
| Access mode                  | Tool call                                          | Bash command                               |
| Session dedup/context carry  | Yes                                                | No                                         |
| Hash-anchored edit flow      | Yes (via MCP edit tools)                           | No                                         |
| Symbol/content/regex/callers | Yes                                                | Yes                                        |
| Deps/blast-radius            | Yes                                                | Yes                                        |
| Codebase map                 | Limited by toolset                                 | Yes (`--map`)                              |
| Best for                     | Interactive main-agent navigation + edit workflows | Subagent discovery/exploration without MCP |

### Example subagent dispatch

```ts
task({
  subagent_type: "worker",
  prompt: `Use tilth CLI via Bash for navigation.

1) Locate symbol and usages:
npx -y tilth initCommand --scope src/

2) Find callers:
npx -y tilth --kind callers initCommand --scope src/

3) Check blast radius before edits:
npx -y tilth --deps src/commands/init.ts --scope src/

4) Read only the relevant section:
npx -y tilth src/commands/init.ts --section 500-620

Then implement the requested change with minimal file edits.`,
});
```

## Cost Awareness

Navigation cost compounds quickly. Optimize for fewer, richer calls.

- Prefer one structural search over multiple blind reads
- Reuse search output; avoid duplicate reads of the same symbol body
- Scope aggressively (`path`, `scope`) to cut noise
- Use section reads for large files instead of full-file pulls

Target heuristic: understand a symbol and its direct impact in **≤3 calls** whenever possible.

## Common Mistakes

| Mistake                                          | Better pattern                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| Reading big files before locating symbol         | Search first, then section read                                     |
| Re-reading code already shown in search output   | Work from returned snippet; re-read only if needed for edit anchors |
| Serially tracing one function at a time          | Multi-symbol search + callers/deps                                  |
| Ignoring blast radius before API/signature edits | Run references/incoming/deps first                                  |
| Unscoped repository-wide search                  | Use `path`/`--scope` to localize                                    |
| Using CLI defaults when mode is ambiguous        | Force with `--kind`                                                 |
| Overusing `--full` on large files                | Outline first, then `--section`                                     |
