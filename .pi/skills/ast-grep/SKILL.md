---
name: ast-grep
version: 1.0.0
description: "Use when searching for code patterns structurally, finding anti-patterns, enforcing conventions, or checking for specific AST patterns across the codebase — ast-grep is an AST-aware structural code search tool (like grep for syntax trees). Supports TS/JS, Rust, Go, Python, Java, and more."
---

# ast-grep — Structural Code Search

ast-grep (`sg`) is a CLI tool that searches code by **AST structure**, not by text. Unlike `grep` or `rg` which match strings, ast-grep understands code syntax — it can find patterns like "all `if (x != null)` that should be `x != null` in TypeScript".

**Install:**

| Method | Command | Binary |
|--------|---------|--------|
| cargo | `cargo install ast-grep` | `ast-grep` only |
| npm | `npm install -g @ast-grep/cli` | `sg` and `ast-grep` |
| brew | `brew install ast-grep` | `ast-grep` only |
| npx | `npx --yes --package @ast-grep/cli sg` | on-demand (no install) |

**CLI binary:** `sg` when available (npm), otherwise `ast-grep` (cargo/brew/Linux).

## When to use

| Tool | Best for | When to use |
|---|---|---|
| `grep` / `rg` | Text/string matching | Quick literal searches, regex patterns |
| `srcwalk_search` | Symbol definitions, usages, call graphs | Code navigation, finding where things are defined/used |
| **`sg` (ast-grep)** | **Structural patterns, anti-patterns, conventions** | Finding `console.log`, `any` type, `TODO`, empty catch, hardcoded values |
| Fallow | Dead code, complexity, quality | Code health audits |

### When ast-grep is better than grep

- Pattern is syntactically meaningful (e.g., `a + b` not just text `a + b`)
- Need to match nested structures (e.g., `try { ... } catch { }`)
- Need to exclude commented-out code or strings (AST-aware, not text-match)
- Need to capture parts of the match (meta variables like `$MSG`)

### When NOT to use ast-grep

- Simple literal text search (use `grep` / `rg`)
- Symbol definition lookups (use `srcwalk_search`)
- Pattern requires multiple files' context (use `srcwalk_callers`)

## Quick reference

### One-off search (`sg run`)

The binary is `sg` (or `ast-grep` on Linux). When installed globally:
```bash
sg -p 'console.log($$$)'
```

Via npx (no install needed — Pi uses this):
```bash
npx --yes --package @ast-grep/cli sg -p 'console.log($$$)'
```

> **Tip:** Define a shell alias to save typing: `alias sg="npx --yes --package @ast-grep/cli sg"`

```bash
# Basic pattern search
npx --yes --package @ast-grep/cli sg -p 'console.log($$$)'          # All console.log calls
npx --yes --package @ast-grep/cli sg -p 'console.log($$$)' -l ts    # Only TypeScript files
npx --yes --package @ast-grep/cli sg -p 'if ($COND) { $$$ }'        # All if blocks
npx --yes --package @ast-grep/cli sg -p 'async function $NAME($$$) { $$$ }'  # All async functions
npx --yes --package @ast-grep/cli sg -p 'function $NAME($$$) { $$$ }' -l go   # All Go functions

# With meta-variable capture (like regex groups)
npx --yes --package @ast-grep/cli sg -p '$OBJ.$METHOD()'            # All method calls (no args)
npx --yes --package @ast-grep/cli sg -p '$A == $A'                  # Self-comparison (like x == x)

# With context
npx --yes --package @ast-grep/cli sg -p 'TODO' -C 1                 # TODO comments with 1 line context

# As JSON for the LLM to parse
npx --yes --package @ast-grep/cli sg -p 'console.log($$$)' --json
npx --yes --package @ast-grep/cli sg -p 'console.log($$$)' --json pretty    # Human-readable JSON
npx --yes --package @ast-grep/cli sg -p 'console.log($$$)' --json compact   # One JSON object per line

# Restrict paths
npx --yes --package @ast-grep/cli sg -p 'import { $$$ } from "$MODULE"' src/  # Only search src/

# Restrict by glob
npx --yes --package @ast-grep/cli sg -p 'TODO' --globs '!node_modules/**'     # Exclude node_modules

# Show file paths only
npx --yes --package @ast-grep/cli sg -p 'TODO' --heading always               # Show filename heading
```

### Meta variables

```
$VARIABLE   — Matches any single AST node (like regex dot, but AST-aware)
$$$         — Matches zero or more AST nodes (arguments, statements, parameters)
$_          — Non-capturing variable (faster, no bookkeeping)
$$NAME      — Captures unnamed AST nodes (advanced)
$A == $A    — Same-name variables must match identical nodes
```

### Language auto-detection

ast-grep auto-detects language from file extension. You can override:
```bash
sg -p 'fn $NAME($$$) { $$$ }' -l rust       # Force Rust syntax
sg -p 'func $NAME($$$) { $$$ }' -l go        # Force Go syntax
```

> **Shortcut for examples below:** All commands shown as `sg -p 'pattern'`. Replace `sg` with `npx --yes --package @ast-grep/cli sg` when using npx, or install globally with `npm install -g @ast-grep/cli`.

## Useful patterns by language

### TypeScript / JavaScript

```bash
# Debugging / logging
sg -p 'console.log($$$)'                    # Leftover console.log
sg -p 'console.error($$$)'                  # Leftover console.error
sg -p 'debugger'                            # Leftover debugger statements

# Error handling
sg -p 'catch ($$$) { }'                     # Empty catch blocks
sg -p 'catch ($$$) { $_ }'                  # Catch with only comments
sg -p 'try { $$$ } catch ($ERR) { $$$ }'    # All try-catch blocks

# Type issues
sg -p 'as any'                              # `as any` type casts
sg -p '$VAR as any'                          # All explicit `as any` 
sg -p ': any'                               # `any` type annotations

# Async / promise
sg -p 'await $PROMISE'                      # All await expressions
sg -p 'Promise.all($$$)'                    # Promise.all calls
sg -p '.then($$_)'                           # .then chains (vs await)

# Common issues
sg -p '$A == $A'                            # Self-comparison
sg -p '$A != $A'                            # Self-inequality (always false)
sg -p '!!$EXPR'                              # Double negation
sg -p 'parseInt($$$)'                       # parseInt (prefer Number())
sg -p 'Math.floor($EXPR / $EXPR2)'          # Integer division pattern

# React specific
sg -p 'useEffect($$$)'                      # All useEffect calls
sg -p 'useEffect($$_)'                       # useEffect with one arg (no cleanup)
sg -p 'useMemo($$$)'                        # All useMemo calls
sg -p 'key={$KEY}'                          # React key props
```

### Rust

```bash
sg -p 'unwrap()'                            # All unwrap() calls (potential panics)
sg -p 'expect($$$)'                         # All expect() calls
sg -p 'todo!()'                             # Leftover todo!() macros
sg -p 'println!($$$)'                       # Leftover debug println!
sg -p 'dbg!($$$)'                           # Leftover dbg!() calls
sg -p 'fn $NAME(&self, $$$) { $$$ }'        # &self methods
sg -p 'fn $NAME(&mut self, $$$) { $$$ }'    # &mut self methods
sg -p 'unsafe { $$$ }'                      # Unsafe blocks
sg -p '#[allow($$$)]'                        # Suppressed warnings
sg -p 'Box::new($$$)'                        # Box allocations
sg -p 'Arc::new($$$)'                        # Arc allocations
sg -p '.clone()'                             # Clone calls
sg -p '.clone()' -C 1                       # Clone with context
```

### Go

```bash
sg -p 'if err != nil { $$$ }'               # All error checks
sg -p 'func $NAME($$$) error { $$$ }'       # Functions returning error
sg -p 'defer $FUNC($$$)'                    # Defer statements
sg -p 'panic($$$)'                          # Panic calls (leftover?)
sg -p 'fmt.Print($$$)'                       # Debug print statements
sg -p 'fmt.Println($$$)'                    # Debug println statements
sg -p 'log.Fatal($$$)'                       # Fatal log calls
sg -p 'go $FUNC($$$)'                        # Goroutine spawns
sg -p 'type $NAME interface { $$$ }'        # Interface definitions
sg -p '$VAR := $VAL'                        # Short variable declarations
```

### Python

```bash
sg -p 'print($$$)'                           # Debug print statements
sg -p 'print($$$)' -l python --globs '!tests/**'  # Print statements outside tests
sg -p 'except: ${$$$}'                      # Bare except clauses
sg -p 'except:${$$$}'                        # Bare except with body
sg -p 'pass'                                # Todo/placeholder pass
sg -p 'TODO'                                # TODO comments
sg -p 'type: ignore'                        # Type ignore suppressions
sg -p 'if $COND:${$$$}pass'                 # Empty if blocks
sg -p '# type: ignore'                      # Type ignore comments
sg -p 'typing.cast($$$)'                    # Type casts
sg -p 'json.loads($$$)'                     # JSON parsing
```

### Java

```bash
sg -p 'System.out.println($$$)'             # Debug print statements
sg -p 'System.err.println($$$)'             # Debug error prints
sg -p 'catch ($$$ $EXC) { }'                # Empty catch blocks
sg -p 'e.printStackTrace()'                 # Stack trace prints
sg -p 'TODO'                                # TODO comments
sg -p 'log.debug($$$)'                       # Debug log statements
sg -p 'new ArrayList<>()'                   # ArrayList instantiations
sg -p 'Optional.of($$$)'                     # Optional usage
sg -p '$VAR != null'                        # Null checks
sg -p 'null != $VAR'                        # Yoda-style null checks
```

## Running rules with `sg scan`

For repeatable checks, define rules in YAML files and run with `sg scan`.

> All `sg scan` commands can be prefixed with `npx --yes --package @ast-grep/cli`
> if ast-grep is not installed globally.

### Quick inline rule (no config file)

```bash
sg scan --inline-rules '
id: no-console-log
language: TypeScript
rule:
  pattern: console.log($$$)
severity: warning
' --json
```

### With a rule file

Save to, e.g., `rules/no-console.yml`:
```yaml
id: no-console-log
message: "Remove console.log before committing"
severity: warning
language: TypeScript
rule:
  pattern: console.log($$$)
note: |
  Use a proper logger or remove before committing.
```

Run it:
```bash
sg scan --rule rules/no-console.yml --json
```

### Advanced rule: empty catch blocks

```yaml
id: no-empty-catch
message: "Empty catch blocks swallow errors"
severity: error
language: TypeScript
rule:
  pattern: catch ($ERR) { }
note: |
  Either handle the error or at least log it.
```

### Advanced rule: `any` detection

```yaml
id: no-explicit-any
message: "Avoid `any` type. Use `unknown` or a proper type."
severity: warning
language: TypeScript
rule:
  regex: "as any"
```

### Running with a config file (sgconfig.yml)

```yaml
# sgconfig.yml — place in project root
ruleDirs:
  - rules
testConfigs:
  - test
```

Then just:
```bash
sg scan
```

## Using with Pi

### Best practices

1. **Use `--json` for structured output** when the LLM needs to parse results:
   ```bash
   sg -p 'console.log($$$)' --json
   ```

2. **Scope searches to relevant paths** to avoid noise:
   ```bash
   sg -p 'unwrap()' src/ --globs '!tests/**'
   ```

3. **Use `-C` context** when you need surrounding code:
   ```bash
   sg -p 'unwrap()' -C 2
   ```

4. **Use `--heading always`** for readable grouped output:
   ```bash
   sg -p 'TODO' --heading always
   ```

5. **Chain with detection first**: check if ast-grep is available:
   ```bash
   command -v sg || command -v ast-grep
   ```

### When ast-grep is useful for the agent

- **Pre-edit analysis**: "Find all places where we call `unwrap()` before I change the error handling"
- **Post-edit verification**: "Check that no new `console.log` calls were introduced"
- **Architecture queries**: "Find all `any` casts in the codebase to plan a migration"
- **Convention enforcement**: "Check if there are empty catch blocks"
- **Migration planning**: "Show all `React.FC` usages before removing the pattern"

## ast-grep vs other Pi tools

| Task | Right tool |
|---|---|
| "Find where function X is defined" | `srcwalk_search` |
| "Find all files calling X" | `srcwalk_callers` |
| "Find all `any` type casts" | `sg -p 'as any'` |
| "Find unused files" | `npx fallow dead-code` |
| "Find all error handling patterns" | `sg -p 'if err != nil'` |
| "Check compilation errors" | `diagnostics` tool |
