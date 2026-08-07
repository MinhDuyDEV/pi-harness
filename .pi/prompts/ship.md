---
description: Implement a planned work session — updates `<repo-root>/.pi/artifacts/PROGRESS.md` with run report and review
argument-hint: "<title> [--quick] [--no-verify] [--dry-run]"
---

# Ship: $ARGUMENTS

Resolve `<repo-root>` before using any durable path below: prefer the Git top-level containing both `package.json` and `.pi`; if Git fails or validation fails, walk ancestors from the current directory for that pair. Stop if none exists, then use absolute `<repo-root>/.pi/...` paths.

Implement the work session plan.

## 1. Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<title>` | required | Work session title (must exist in `TODO.md`) |
| `--quick` | false | Skip the post-step verification per step |
| `--no-verify` | false | Skip the final repository-defined gate run |
| `--dry-run` | false | Show the planned file changes without writing them |

## Ownership boundary
- This prompt owns ship gating, artifact transitions, and the next command. Load `shipping-and-launch` for release safety and `verification-before-completion` for evidence rules; do not duplicate their detailed checklists.

## 2. Find Work Session

Use the available repository text/semantic search tool to locate the exact `### ... - <title>` blocks in `<repo-root>/.pi/artifacts/TODO.md` and `<repo-root>/.pi/artifacts/PLAN.md`; do not assume `rg` is installed.

If not found: "Run `/create <title>` and `/plan <title>` first."

## 3. Read Plan

Read the work session blocks from `PLAN.md` (Spec, Plan, Phases if present) and `DECISIONS.md` (ADRs if present). Build a step queue.

## 4. Implement

Execute the steps in order. For each step:
- Mark it in_progress — prefer the `todo` tool: `todo start "<step>"` (sets `[/]`, completes the previous in_progress, drives the live TUI widget spinner); otherwise edit `TODO.md` `[ ]` → `[/]` in place
- Implement the step, then run its verification (skip with `--quick`); on failure, stop and report
- Mark it done — prefer `todo done "<step>"` (sets `[x]`, auto-promotes the next pending in the phase); otherwise edit `TODO.md` `[/]` → `[x]` in place

`--dry-run` halts here. Show the planned file changes (read first, list, summarize) and stop.

## 5. Final Gates (skip with `--no-verify`)

Discover the project's authoritative gates from the nearest project
instructions, checked-in wrappers, build/package manifests, lockfiles, and CI.
Prefer one repository aggregate check when available; otherwise choose the
smallest build/type, lint/static, and test commands supported by evidence in
the repo. Apply the repository's gate-discovery semantics: checked-in wrappers win, conflicting lockfiles are a blocker, and no package runner is guessed. If the harness package is installed, consult its documented gate-discovery behavior; do not assume `scripts/lib/discover-gates.mjs` exists in the consumer.
Do not assume npm or even a JavaScript project. Record the exact
command, cwd, exit status, and discovery source. If any required gate fails,
stop and report.

## 6. Self-Review

This is a pre-filter, not the review: it catches the obvious before handing off, and does not replace an independent reviewer or proof audit (`/verify <title> --review` / `--audit`).

After gates pass, review the diff:
- Critical: bug, security issue, broken build
- Important: missing test, missing error handling, unclear code
- Minor: style, naming, doc

Fix Critical and Important before completion. Minor can ship and be cleaned up later.

## 7. Update Blocks

Shipping records implementation evidence but does not complete the work session. Independent verification owns the transition to `done`.

### `<repo-root>/.pi/artifacts/TODO.md`

Keep the phase active. Mark implementation steps complete, but ensure `/verify <title>` is a pending item. Do not close the phase with the todo tool, do not set the phase to `done`, and do not mark verification complete during `/ship`. Add the run report reference and keep the block in place.

```markdown
### YYYY-MM-DD - <title>
status: active | updated: YYYY-MM-DD

- [x] Step 1: <name>
- [x] Step 2: <name>
- [ ] /verify <title> (pending)

See: `PROGRESS.md#YYYY-MM-DD--<slug>`
```

### `<repo-root>/.pi/artifacts/PROGRESS.md`

Append or update the work session block with the run report and self-review:

```markdown
### YYYY-MM-DD - <title>
status: awaiting-verification | updated: YYYY-MM-DD

#### Run Report
- Steps: N/M implementation steps done
- Gates: `<exact discovered command>` PASS/FAIL/SKIPPED (repeat per gate)
- Files changed: <list, or "see git diff">

#### Review
- Critical: 0
- Important: N (<list>)
- Minor: N (<list>)
```

When `--no-verify` is used, record every omitted final gate as `SKIPPED`; the session still remains `awaiting-verification`. If the block already exists, merge it: keep earlier content and append or update subsections.

## 8. Output

Report:
1. Status: awaiting-verification / blocked
2. Gates: exact discovered commands (PASS / FAIL / SKIPPED with details)
3. Review findings by severity
4. Files changed (count + list, or `git diff --stat`)
5. Anchor: `PROGRESS.md#YYYY-MM-DD--<slug>`
6. **Next:** `/verify <title>`

## Related Commands

| Need | Command |
| --- | --- |
| Verify the implementation | `/verify <title>` |
| Plan a different work session | `/plan <other-title>` |
