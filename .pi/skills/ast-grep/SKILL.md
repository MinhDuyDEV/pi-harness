---
name: ast-grep
description: Use when searching for code patterns structurally, finding anti-patterns, enforcing conventions, or checking
  for specific AST patterns across the codebase — ast-grep is an AST-aware structural code search tool (like grep for syntax
  trees). Supports TS/JS, Rust, Go, Python, Java, and more.
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

## Common Mistakes

Using `rg` for code patterns (misses structural matches); forgetting language flag; pattern with too-specific whitespace (use metavariables); running rewrite without dry-run first; "match-all" pattern matches the test fixtures; codemod that breaks a deliberate exception; no verification after rewrite; "I trust the rewrite" without re-running tests; pattern that matches the import + the call (use kinds or fields to disambiguate).

## Red Flags

Using `rg` for "all calls to X" (use ast-grep); pattern with literal variable names; no `$$$` for variadic; no `language: TypeScript` (or the right one); no dry-run before rewrite; rewrite without test re-run; "I checked the diff visually" (run the tests); rule file in wrong dir (project root); pattern matches test fixtures but prod is fine.

## Anti-Patterns

**`rg` for code patterns** (use ast-grep); **literal variable names in pattern** (use `$X`); **no `$$$` for variadic**; **no dry-run**; **rewrite without test re-run**; **"checked the diff"** (run tests); **pattern matches test fixtures** (scope it).
