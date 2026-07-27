---
description: Implement a planned work session — updates `.pi/artifacts/PROGRESS.md` with run report and review
argument-hint: "<title> [--quick] [--no-verify] [--dry-run]"
---

# Ship: $ARGUMENTS

Implement the work session plan.

## 1. Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<title>` | required | Work session title (must exist in `TODO.md`) |
| `--quick` | false | Skip the post-step verification per step |
| `--no-verify` | false | Skip the final gate run (typecheck, lint, test) |
| `--dry-run` | false | Show the planned file changes without writing them |

## 2. Find Work Session

```bash
rg "^### .* - <title>$" .pi/artifacts/TODO.md
rg "^### .* - <title>$" .pi/artifacts/PLAN.md
```

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

Run the project's gates: `npm run typecheck`, `npm run lint`, `npm test`. If any fail, stop and report.

## 6. Self-Review

This is a pre-filter, not the review: it catches the obvious before handing off, and does not replace an independent reviewer or proof audit (`/verify <title> --review` / `--audit`).

After gates pass, review the diff:
- Critical: bug, security issue, broken build
- Important: missing test, missing error handling, unclear code
- Minor: style, naming, doc

Fix Critical and Important before completion. Minor can ship and be cleaned up later.

## 7. Update Blocks

### `.pi/artifacts/TODO.md`

Mark the phase done — prefer the `todo` tool: `todo done "<title>"` (sets every remaining item `[x]` and `status: done`, promotes the next active phase); otherwise set each checkbox `[x]` and the `status:` line to `done` in place. Add the run report reference. Keep the block in place.

```markdown
### YYYY-MM-DD - <title>
status: done | updated: YYYY-MM-DD

- [x] Step 1: <name>
- [x] Step 2: <name>
- [x] /verify

See: `PROGRESS.md#YYYY-MM-DD--<slug>`
```

### `.pi/artifacts/PROGRESS.md`

Append or update the work session block with run report and review:

```markdown
### YYYY-MM-DD - <title>
status: done | updated: YYYY-MM-DD

#### Run Report
- Steps: N/M done
- Gates: typecheck PASS, lint PASS, test PASS
- Files changed: <list, or "see git diff">

#### Review
- Critical: 0
- Important: N (<list>)
- Minor: N (<list>)
```

If the block already exists (continuation), merge — keep earlier content, append or update subsections.

## 8. Output

Report:
1. Status: done / blocked
2. Gates: typecheck / lint / test (PASS / FAIL with details)
3. Review findings by severity
4. Files changed (count + list, or `git diff --stat`)
5. Anchor: `PROGRESS.md#YYYY-MM-DD--<slug>`
6. **Next:** `/verify <title>`

## Related Commands

| Need | Command |
| --- | --- |
| Verify the implementation | `/verify <title>` |
| Plan a different work session | `/plan <other-title>` |
