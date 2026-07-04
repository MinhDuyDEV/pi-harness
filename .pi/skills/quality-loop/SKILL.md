---
name: quality-loop
version: 1.0.0
description: "Use after implementation when an iterative fix-verify loop is needed until all quality gates pass or max iterations reached. Prevents the 'single-shot verification' failure mode where a fix introduces new issues."
tags: [workflow, code-quality, verification]
dependencies: [verification-before-completion]
agent_types: [worker, reviewer]
tools: [bash, grep, find, read]
---

# Quality Loop — Iterative Fix-Verify

## When to Use

- After implementing a feature, fix, or refactor
- Before claiming completion, committing, or creating a PR
- After any change that could break existing behavior — especially multi-file changes

Supplements `verification-before-completion` by adding the **loop** structure: verify → fix → re-verify until clean.

## When NOT to Use

- During active prototyping or exploration where breakage is expected
- For trivial one-line fixes — use direct verification instead
- When verification commands take >30s per run — the loop becomes impractical

## Flow

```
for iteration in 1..MAX_ITERATIONS:
   1. Run all quality gates
   2. if ALL pass → break, report success
   3. Collect failures (specific errors, file:line)
   4. Auto-fix each failure
   5. if no progress since last iteration → break
   6. Commit fixes (if in a git context)
   7. Next iteration

if exited with failures:
   Report remaining issues, suggest next steps
```

Default max: **3 iterations**. Override via skill metadata if the task complexity warrants more.

## Gate Priority

Run in this order so cheaper gates catch issues before expensive ones:

| Priority | Gate | Check | Auto-fix? |
|---|---|---|---|
| 1 | **Type check** | `npx tsc --noEmit` or project's typecheck command | Yes — fix types or code |
| 2 | **Lint** | `npx eslint .` or project's lint command | Yes — `--fix` flag |
| 3 | **Unit tests** | `npx vitest run` or project's test command | Conditional — fix implementation to match test |
| 4 | **Intergration tests** | Only if project has them and unit tests pass | Conditional |
| 5 | **TODO.md** | All `[ ]` boxes checked off to `[x]` | Yes — verify and check off |
| 6 | **Stub detection** | Search for `TODO`, `FIXME`, `placeholder`, `return null`, `<div>Component</div>` | Yes — replace with real implementation |
| 7 | **Sprint/plan criteria** | Custom criteria from the sprint or plan | Conditional |

Skip gates that don't apply (e.g., no typecheck in plain JS projects). Always run at least typecheck + tests + TODO.md.

## Auto-Fix Rules

For each gate failure, apply the narrowest fix:

| Failure | Fix |
|---|---|
| **Type error** | Fix the type annotation or the code producing incompatible types |
| **Lint error** | `npx eslint --fix .` (or equivalent) — if still failing, fix manually |
| **Test failure** | Read the test to understand expectations, fix implementation |
| **Missing `[x]`** | Verify the step is actually done, then check it off |
| **Stub (TODO/FIXME in code)** | Replace with working implementation |
| **Stub (empty component)** | Wire up real props, handlers, and rendering |
| **Criterion not met** | Look at what's missing, implement it |

## Exit Conditions

Stop when any of these are true:

1. **All gates pass** — success, work is clean
2. **Max iterations reached** — report remaining issues honestly
3. **No progress** — the same failures exist as the previous iteration (nothing left to auto-fix). Report and stop instead of spinning.

## Multi-File Changes

For changes spanning 3+ files:
- After auto-fixing in an iteration, run the full gate suite again — fixing one file may break another
- Pay special attention to integration points (imports, type exports, function signatures)
- Check that the diff still makes sense after fixes — auto-fixes can produce weird code

## Report

Always output this summary after the loop:

```
Quality loop: <iterations>/<max> iterations
  Typecheck:  pass | fail (<details>)
  Lint:       pass | fail (<details>)
  Tests:      pass (<N>/<N>) | fail (<details>)
  TODO.md:    pass (<N>/<N>) | fail (<details>)
  Stubs:      pass | fail (<details>)
  Criteria:   pass | fail (<details>)
  Fixes applied: <N>
  Clean:      yes | no

  Remaining (if any):
  - file:line — description
  - file:line — description
```

## Example

```markdown
Quality loop: 2/3 iterations
  Typecheck:  pass
  Lint:       pass
  Tests:      pass (14/14)
  TODO.md:    pass (6/6)
  Stubs:      pass
  Criteria:   pass
  Fixes applied: 2
  Clean:      yes
```

Not clean:

```markdown
Quality loop: 3/3 iterations
  Typecheck:  pass
  Lint:       fail (2 warnings — no-console, unused-vars)
  Tests:      pass (14/14)
  TODO.md:    pass (6/6)
  Stubs:      pass
  Criteria:   pass
  Fixes applied: 3
  Clean:      no

  Remaining:
  - src/utils.ts:42 — unused variable 'temp'
  - src/auth.ts:15 — console.log left in production code
```
