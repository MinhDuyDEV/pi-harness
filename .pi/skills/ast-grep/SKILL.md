---
name: ast-grep
description: Structural code search and rewrite with ast-grep — AST-aware patterns instead of text. Use when finding all calls to X, hunting anti-patterns, enforcing conventions via rules, or running codemods.
metadata:
  version: 1.0.0
---

# AST-Grep (Structural Code Search)

## When to Use

Searching for code patterns structurally (not text); finding anti-patterns across a codebase; enforcing conventions; codemod-style edits; "find every call to X with these args"; "find every place that uses Y"; renaming across complex patterns.

## When NOT to Use

Simple text search (use `rg`); semantic search (use grep + reading); small one-file change; the pattern is a single string.

## Core Principle

**AST-grep matches syntax, not text.** Same variable, different names? Still matches. Different whitespace, different line breaks? Still matches. The query is a *code pattern*; the search respects the language's grammar.

## Core Commands

```bash
# Find: list matching files + lines
ast-grep run -p 'console.log($MSG)' -l ts

# Scan: project-wide with rule files
ast-grep scan

# Rewrite in place (--update-all for many)
ast-grep run -p 'foo($A, $B)' -r 'bar($B, $A)' -l ts
```

Rule files (YAML) define reusable patterns. `sgconfig.yml` at the repo root configures the project.

## Rule Anatomy

```yaml
# rule.yml
id: no-console-log
language: TypeScript
rule:
  pattern: console.log($$$ARGS)
  # or:
  # kind: call_expression
  # has:
  #   field: function
  #   pattern: console.log
fix: $$$ARGS  # optional rewrite
```

`$$$ARGS` = "rest" (any number of args). `$A`, `$B` = named metavariables (matched across the pattern).

## Common Patterns

| Want | Pattern |
|---|---|
| All calls to `X` | `X($$$ARGS)` |
| All `await` calls | `await $EXPR` |
| All `console.log` | `console.log($$$ARGS)` |
| `try/catch` blocks | `try { $$$BODY } catch ($E) { $$$HANDLER }` |
| Class with field `X` | `class $C { $$$FIELDS }` where field exists |
| Object with key `X` | `{ $K: $V, $$$REST }` |

`$$$` for "rest of", `$` for "single".

## Codemod Workflow

1. **Write the rule** (pattern + optional fix).
2. **Run dry-run** (`--dry-run` or just scan) to see the matches.
3. **Verify count makes sense** (e.g., 50 calls to a deprecated function).
4. **Run with `--update-all`** to rewrite.
5. **Re-run tests.** Some rewrites break things.
6. **Commit the rewrite** as a single commit.

## Red Flags

Using `rg` for "all calls to X" (misses structural matches — use ast-grep); pattern with literal variable names (use `$X`); no `$$$` for variadic args; missing language flag (`-l ts` or `language:` in the rule); pattern with too-specific whitespace (use metavariables); pattern matching both the import and the call (use kinds or fields to disambiguate); no dry-run before rewrite; codemod that breaks a deliberate exception; pattern matching test fixtures (scope it); "I checked the diff visually" / "I trust the rewrite" (re-run the tests).
