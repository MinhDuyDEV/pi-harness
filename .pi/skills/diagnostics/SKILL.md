---
name: diagnostics
description: Use when checking for code errors, type issues, or lint warnings after making changes, before committing, or when troubleshooting build failures
---

# Diagnostics

## When to Use

Running code diagnostics after edits to verify typecheck, lint, and tests pass before claiming done. Part of the verification-before-completion workflow.

## Workflow

1. Run diagnostics on the changed files: `diagnostics(file="src/foo.ts", scope="changed")`.
2. If errors: fix the first one, re-run, repeat until clean.
3. If no errors but suspicious: run full-project diagnostics.
4. Commit only when diagnostics are green.

## Parameters

| Param | Value | Effect |
|---|---|---|
| `scope` | `"changed"` | GitHub/worktrees diff scope |
| `scope` | `"full"` | Full project, every file |
| `languages` | `["typescript"]` | Language / runner filter |
| `includeFallow` | `true` (default) | Dead code, duplications |
| `includeAislop` | `true` | AI slop detection |

Use `scope="changed"` for most checks. Use `scope="full"` after refactors or when suspicion is high.

## Fallow Integration

If `includeFallow: true`, diagnostics runs `fallow health --changed-since main` (dead code, duplication, complexity) and `fallow audit` (blast radius). Report fallout as part of the diagnostics output.

## Common Mistakes

Running without `scope="changed"` (full project is slow); running without `languages` filter (runs all); ignoring fallow output; "I'll run later" (run now, fix before commit); running diagnostics on the wrong branch; not running after significant edits; "the typecheck passes, so it's fine" (check lint + fallow too).

## Anti-Patterns

**No scope filter**; **no language filter**; **ignore fallow**; **"run later"**; **wrong branch**; **no run after edits**; **"typecheck is enough"**.
