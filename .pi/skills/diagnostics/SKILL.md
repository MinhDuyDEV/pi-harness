---
name: diagnostics
description: Documents the diagnostics() tool — one call running typecheck, lint, Fallow, and aislop. Use when verifying changes before claiming done, before committing, or when troubleshooting build failures.
---

# Diagnostics

## When to Use

Running code diagnostics after edits to verify typecheck, lint, and tests pass before claiming done. Part of the verification-before-completion workflow.

## Prerequisite

The `diagnostics()` tool is provided by this repo's local extension at `.pi/extensions/diagnostics/` (entry `.pi/extensions/diagnostics.ts`), not by Pi core. Porting this skill to another repo means porting that extension too. It auto-detects TypeScript, Rust, Go, and Python runners.

## Workflow

1. Run diagnostics on the changed files: `diagnostics(file="src/foo.ts", scope="changed")`.
2. If errors: fix the first one, re-run, repeat until clean.
3. If no errors but suspicious: run full-project diagnostics.
4. Commit only when diagnostics are green.

## Parameters

| Param | Value | Effect |
|---|---|---|
| `scope` | `"changed"` | Fallow scoped to git diff since `changedSince` (default `main`) |
| `scope` | `"full"` | Full project, every file (the default) |
| `languages` | `["typescript"]` | Runner filter: `typescript`, `rust`, `go`, `python` |
| `includeFallow` | `true` | Dead code, duplication (default when tsconfig.json exists) |
| `includeAislop` | `true` | AI slop detection (default unless env opts out) |
| `file` | `"src/foo.ts"` | Only runners matching this file's extension |

Use `scope="changed"` for most checks. Use `scope="full"` after refactors or when suspicion is high.

## Fallow Integration

If `includeFallow: true`, diagnostics runs `fallow health --changed-since main` (dead code, duplication, complexity) and `fallow audit` (blast radius). Report fallout as part of the diagnostics output.

## Red Flags

Running full scope for routine checks (slow — scope to changed); ignoring fallow output; "I'll run later" (run now, fix before commit); running on the wrong branch; not running after significant edits; "the typecheck passes, so it's fine" (check lint + fallow too).
