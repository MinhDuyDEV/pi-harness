---
description: Verify completeness, correctness, and quality — appends a verification section to the work session block in `.pi/artifacts/PROGRESS.md`
argument-hint: "<title> [--quick] [--test] [--review] [--ui-review] [--gate-only]"
agentType: reviewer
---

# Verify: $ARGUMENTS

Check the implementation against the spec, run gates, write tests, and review code.

## 1. Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<title>` | required | Work session title |
| `--quick` | false | Gates only; skip completeness and review |
| `--test` | false | Write tests for the target code (TDD: red → green → refactor) |
| `--review` | false | Manual code review by severity |
| `--ui-review` | false | UI/UX audit with slop-mode scoring |
| `--gate-only` | false | Run gates and stop; no completeness checks |

## 2. Find Work Session

```bash
rg "^### .* - <title>$" .pi/artifacts/TODO.md
rg "^### .* - <title>$" .pi/artifacts/PROGRESS.md
```

If not found: "Run `/create <title>` and `/ship <title>` first."

## 3. Read Work Session

Read all blocks for this work session:
- `PLAN.md` — Spec, Plan, Phases
- `PROGRESS.md` — Run Report, Review (if present)
- `DECISIONS.md` — ADRs (if present)

## 4. Run Verification

### Default: Completeness + Correctness

For each requirement in `#### Spec`:

| Status | Meaning |
| --- | --- |
| ✓ Complete | Code evidence found; behavior matches the requirement |
| ◐ Partial | Some evidence; missing edge case or error path |
| ✗ Missing | No code evidence |

Then run gates: `npm run typecheck`, `npm run lint`, `npm test`. Report each PASS/FAIL.

### `--gate-only`

Run gates only. Stop. Report.

### `--test`: Write Tests (TDD)

1. Read the target code
2. Write a failing test for one requirement
3. Run it; confirm red
4. Make the test pass
5. Refactor if needed
6. Repeat per requirement

### `--review`: Code Review

For each file in the diff, review by severity:

- **Critical** — bug, security issue, broken build, race condition
- **Important** — missing test, missing error handling, unclear contract
- **Minor** — style, naming, doc, consistency

Fix Critical/Important. Minor can ship.

### `--ui-review`: UI/UX Audit

For each UI file, score 0-10 on slop-mode (0-3 clean, 4-6 acceptable, 7-10 critical). Report findings.

## 5. Update Blocks

### `.pi/artifacts/PROGRESS.md`

Add or update the `#### Verification` subsection of the work session block:

```markdown
### YYYY-MM-DD - <title>
status: done | updated: YYYY-MM-DD

#### Verification
- Completeness: N/M (P%)
- Gates: typecheck PASS, lint PASS, test PASS
- Review: Critical 0, Important N, Minor N
- Result: READY TO SHIP / NEEDS WORK / BLOCKED
- Blocking issues: <list, or "none">
```

If `--review` or `--ui-review` is set, add their subsections too.

### Update `status: done` in `.pi/artifacts/TODO.md` and `.pi/artifacts/PLAN.md`

Edit the `status:` line in place. Do not move or hide the block.

## 6. Output

Report:
1. Result: **READY TO SHIP** / **NEEDS WORK** / **BLOCKED**
2. Completeness: N/M (P%)
3. Gates table
4. Review findings (if `--review`)
5. UI scores (if `--ui-review`)
6. Blocking issues (or "none")
7. Anchor: `PROGRESS.md#YYYY-MM-DD--<slug>`

## Related Commands

| Need | Command |
| --- | --- |
| Fix issues found | `/ship <title>` (with the work session block now showing what's left) |
| Re-verify after fixes | `/verify <title>` |
