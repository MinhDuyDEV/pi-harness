---
name: tilth-cli
description: AST-aware code navigation via tilth CLI. Use when subagents need structural code search, smart file reading, or codebase mapping — complements MCP tilth (which only the main agent can access).
version: 2.0.0
tags: [code-navigation, search, subagent]
dependencies: []
---

# tilth CLI for Subagents

> **Why this exists:** tilth MCP tools (`tilth_tilth_search`, `tilth_tilth_read`, etc.) are only available to the main agent. Subagents cannot access MCP tools but CAN use Bash. This skill teaches subagents to call tilth directly from the command line.

## When to Use

- When subagents need structural code search (they cannot access tilth MCP tools)
- When you need `--map` for codebase skeleton (CLI-only feature, not in MCP)
- For any agent that has Bash access but not tilth MCP

## When NOT to Use

- Main agent should prefer tilth MCP tools — they have session dedup and hash-anchored editing
- For trivial lookups where grep/read suffices

## Prerequisites

tilth must be available. Use `npx -y tilth` if not globally installed:

```bash
npx -y tilth <query> [options]
```

## How tilth CLI Works

tilth has **one command** with **smart auto-detection**. Pass a query and it figures out what to do:

| Query Pattern | Detection                        | Action                                                  |
| ------------- | -------------------------------- | ------------------------------------------------------- |
| `src/auth.ts` | File path (exists on disk)       | **Read file** — smart outline for large, full for small |
| `handleAuth`  | Symbol name (camelCase, etc.)    | **Symbol search** — AST definitions + usages            |
| `"*.test.ts"` | Glob pattern (contains `*`, `?`) | **File listing** — matched paths with token estimates   |
| `"TODO fix"`  | Text (doesn't match above)       | **Text search** — literal content matches               |

## Core Operations

### 1. Read a File

```bash
npx -y tilth src/index.ts                      # Smart view (outline if large, full if small)
npx -y tilth src/index.ts --full                # Force full content
npx -y tilth src/index.ts --section 45-89       # Exact line range
npx -y tilth src/index.ts --section "## Config" # By heading
```

Output: numbered lines (`N  content`). Large files get a structural outline; use `--section` to drill into specific ranges.

### 2. Search for Symbols

```bash
npx -y tilth initCommand --scope src/           # Find definition + all usages
npx -y tilth handleAuth --scope src/auth/       # Scoped to subdirectory
npx -y tilth "sym1,sym2" --scope src/            # Multi-symbol search (max 5)
```

Returns: definitions first (with expanded source), then usages with context lines.

### 3. Search for Text / Regex

```bash
npx -y tilth "TODO" --scope src/                # Literal text search
npx -y tilth "version" --scope src/             # Finds all occurrences
npx -y tilth --kind content "config" --scope src/  # Explicit content search
npx -y tilth --kind regex "/TODO.*fix/" --scope src/  # Regex search
```

tilth auto-detects text vs symbol. Identifiers (camelCase, snake_case) → symbol search. Multi-word or quoted strings → text search. Use `--kind` to force a specific search mode.

### 4. Find Callers

```bash
npx -y tilth --kind callers initCommand --scope src/  # Find all call sites
```

Uses SIMD-accelerated pre-filtering + tree-sitter AST parsing. More accurate than text grep for finding actual function calls vs. comments/strings.

### 5. List Files (Glob)

```bash
npx -y tilth "*.test.ts" --scope src/           # List test files
npx -y tilth "*.ts" --scope src/commands/       # List TS files in subdir
```

Returns: matched file paths with token size estimates.

### 6. Blast-Radius Analysis (Deps)

```bash
npx -y tilth --deps src/utils/errors.ts         # What imports this file + what it imports
npx -y tilth --deps src/commands/init.ts --scope src/  # Scoped dependency check
```

Shows imports (local + external) AND what other files call its exports, with symbol-level detail. Use before renaming/removing exports.

### 7. Codebase Map (CLI-Only)

```bash
npx -y tilth --map --scope src/                 # Structural skeleton
npx -y tilth --map --scope .                    # Whole project
```

Returns: directory tree with exported symbols per file. **CLI-only** — deliberately excluded from MCP (agents overuse it).

## Available Flags

| Flag                | Purpose                                  | Example                     |
| ------------------- | ---------------------------------------- | --------------------------- |
| `--scope <DIR>`     | Restrict search to directory             | `--scope src/`              |
| `--section <RANGE>` | Line range or heading for file reads     | `--section 45-89`           |
| `--full`            | Force full file content (skip outline)   | `--full`                    |
| `--budget <N>`      | Max tokens in response                   | `--budget 2000`             |
| `--json`            | Machine-readable JSON output             | `--json`                    |
| `--map`             | Generate codebase structure map          | `--map --scope src/`        |
| `--kind <TYPE>`     | Force search type: symbol/content/regex/callers | `--kind callers`     |
| `--deps`            | Show blast-radius (imports + dependents) | `--deps src/file.ts`        |
| `--expand <N>`      | Top N matches to show full source        | `--expand 3`                |

## MCP vs CLI Comparison

| Feature                               | MCP (main agent) | CLI (all agents)    |
| ------------------------------------- | ---------------- | ------------------- |
| Session dedup (`[shown earlier]`)     | Yes              | No                  |
| Hash-anchored editing (`tilth_edit`)  | Yes              | No                  |
| Blast-radius analysis (`--deps`)      | Yes              | Yes (v0.5.7+)       |
| Multi-symbol search (`sym1,sym2`)     | Yes              | Yes (v0.5.7+)       |
| `--kind` flag (content/regex/callers) | Yes              | Yes (v0.5.7+)       |
| `--expand` control                    | Yes              | Yes (v0.5.7+)       |
| `--map` codebase skeleton             | No               | Yes                 |
| Subagent access                       | No (main only)   | Yes (any with Bash) |
| Process overhead                      | Once (~17ms)     | Per call (~17ms)    |

## Output Format Examples

### File read (small file)

```
# src/config.ts (45 lines, ~380 tokens) [full]

1  import { z } from 'zod';
2  export const schema = z.object({
...
```

### Symbol search

```
# Search: "initCommand" in src/ — 6 matches (2 definitions, 4 usages)

### Definitions (2)
## commands/init.ts:515-961 [definition]
→ [515-961]  export async function initCommand(...)

### Usages — same package (4)
## index.ts:10 [usage]
→ [10]   import { initCommand } from "./commands/init.js";
```

### Codebase map

```
# Map: src/ (depth 3)
index.ts (~1214 tokens)
commands/
  init.ts: initCommand, detectMode, ...
  upgrade.ts: checkVersion, upgradeCommand, ...
utils/
  errors.ts: resolveOpencodePath, showError, ...
```

## Usage Tips

- **Search first, read second** — symbol search finds definitions AND shows expanded source
- **Use `--section` for large files** — outline tells you line ranges; drill in with `--section 44-89`
- **Use `--scope`** to narrow searches — avoids scanning irrelevant directories
- **Use `--budget`** when you need concise output (limits token count)
- **~17ms per call** — fast enough for interactive use, but avoid unnecessary repeated calls
- **Use `--kind callers`** for precise call-site analysis instead of text grep
- **Use `--deps`** before renaming or removing exports to check blast radius

## Example Subagent Dispatch

```typescript
task({
  subagent_type: "general",
  prompt: `Use tilth CLI for code navigation (run via: npx -y tilth).

Find the definition of \`initCommand\` and understand how it's called:
  npx -y tilth initCommand --scope src/
  npx -y tilth --kind callers initCommand --scope src/

Check blast radius before editing:
  npx -y tilth --deps src/commands/init.ts

Then read the relevant file section:
  npx -y tilth src/commands/init.ts --section 515-600

[rest of task instructions]`,
});
```
