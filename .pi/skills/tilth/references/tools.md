# Tilth Tool Reference

## srcwalk_search

Search for symbols, text, or regex patterns in code. Replaces grep/rg.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | string | *required* | Symbol name, text, or regex. Comma-separated for multi-symbol (max 5). |
| `scope` | string | cwd | Only use to search a specific subdirectory. Omit for cwd. |
| `kind` | string | "symbol" | `symbol` (definitions+usages), `content` (literal text), `regex`, `callers` (call sites) |
| `expand` | number | 2 | Number of top matches to expand with full source code |
| `context` | string | — | Path to file being edited — boosts nearby results |
| `budget` | number | — | Max tokens in response |

### Output Format

```
# Search: "query" in scope — N matches (D definitions, U usages)

## path:start-end [definition|usage|impl]
  [outline context lines]
→ [match line]  match text

  start │ expanded source code...
  ...
  end   │ }

── calls ──
  calleeName  path:start-end  signature

── siblings ──
  siblingName  path:start-end  signature
```

### Multi-Symbol

```
srcwalk_search(query: "ServeHTTP, HandlersChain, Next")
```

Each symbol gets separate result block. Expand budget shared — at least 1 per symbol.

## srcwalk_read

Read a file with smart outlining. Replaces cat/head/tail.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `path` | string | — | File path to read (single file) |
| `paths` | string[] | — | Multiple file paths (batch read, max 20) |
| `section` | string | — | Line range `"45-89"` or heading `"## Architecture"` |
| `full` | boolean | false | Force full content, bypass smart outlining |
| `budget` | number | — | Max tokens in response |

### Output Modes

**Full mode** (small files or `full: true`):
```
# path (N lines, ~Xk tokens) [full]

   1 │ import { foo } from './bar';
   2 │ ...
```

**Outline mode** (large files):
```
# path (N lines, ~Xk tokens) [outline]

[1-12]   imports: express(2), jsonwebtoken
[14-22]  interface AuthConfig
[24-42]  fn validateToken(token: string): Claims | null
[44-89]  export fn handleAuth(req, res, next)
```

**Section mode**:
```
srcwalk_read(path: "src/auth.ts", section: "44-89")
```

## srcwalk_files

Find files matching a glob pattern. Replaces find/ls/pwd.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `pattern` | string | *required* | Glob pattern: `"*"`, `"*.rs"`, `"src/**/*.ts"` |
| `scope` | string | cwd | Directory to search |
| `budget` | number | — | Max tokens in response |

### Output

```
# Glob: "*.rs" in . — 15 files

  src/main.rs  (~500 tokens)
  src/lib.rs  (~1.2k tokens)
  ...
```

## srcwalk_deps

Blast-radius check before breaking changes.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `path` | string | *required* | File to check |
| `scope` | string | project root | Directory to search for dependents |
| `budget` | number | — | Max tokens (truncates "Used by" first) |

**Use ONLY when**: changing a function signature, removing/renaming an export, or modifying
behavior that callers rely on. Do NOT use for reading files or adding new code.

## Budget Parameter

All tools accept `budget` — max tokens in response. When output exceeds budget, tilth
truncates intelligently (removes lower-priority matches first, preserves structure).

## Scope Parameter

- **Omit** to search current working directory (most common)
- **Use** only when you need a specific subdirectory
- Invalid scope falls back to cwd with a warning
