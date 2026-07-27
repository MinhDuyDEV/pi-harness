---
description: Verify completeness, correctness, and quality — appends a verification section to the work session block in `.pi/artifacts/PROGRESS.md`
argument-hint: "<title> [--quick] [--test] [--review] [--ui-review] [--gate-only] [--reconcile]"
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
| `--audit` | false | Invoke the `proof-auditor` agent to verify evidence actually proves each claim (fake-green/fake-red/coverage gaps) |
| `--reconcile` | false | Reconcile the backlog against reality (see Reconcile section) |

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

Discover the project's real gates before running them: read the nearest
`AGENTS.md`/project instructions, checked-in wrapper scripts, package or build
manifests, lockfiles, and CI workflows. Prefer the repository's aggregate
check command when one exists; otherwise select the smallest commands that
cover type/build, lint/static analysis, and tests. Do not infer npm, JavaScript,
or command names from this prompt. Use the same evidence and ambiguity rules as
`scripts/lib/discover-gates.mjs`: wrappers take precedence, conflicting
lockfiles block execution, and a missing runner is not guessed. Record every selected command, cwd, exit
status, and why it is authoritative; report each PASS/FAIL/SKIPPED.

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

### `--reconcile`: Reconcile the Backlog

Run when `--reconcile` is set, or proactively after every 3-4 completed tasks. Read `TODO.md`, `PROGRESS.md`, and `DECISIONS.md`, then ask:

1. **Stale tasks** — which open tasks are obsoleted by implementation that landed since they were written? Cite what landed.
2. **Absorbed issues** — which issues were absorbed by larger work? Close only with evidence that the original issue's acceptance criteria are met; "the bigger change probably covers it" is not evidence.
3. **Foundation ordering** — which foundation tasks should move ahead of feature tasks? Order by structural dependency, not by label, tag, or recency (no priority-by-label).

Propose closures and reorderings with the evidence for each; apply after confirmation.
After applying the confirmed changes, append a `#### Reconcile` subsection to
the matching `PROGRESS.md` block with trigger, completed-since-last count,
proposals, and evidence. Then persist the exact result with
`workflow_state action=record_reconcile`. Use `trigger=completion-threshold`
when the workflow reminder caused the run, otherwise `explicit`. The typed
checkpoint resets the durable four-completion trigger; prose alone does not.

### `--audit`: Proof Audit

Delegate to the `proof-auditor` agent with the diff, the spec requirements, and the gate/test output. It returns whether the evidence actually proves each claim — flagging fake-green (tests pass without exercising the requirement), fake-red (failures from environment not code), and coverage gaps (claim broader than evidence). Treat its verdicts as binding for "READY TO SHIP": a claim it grades `not proven` is not done.

## 5. Update Blocks

### `.pi/artifacts/PROGRESS.md`

Add or update the `#### Verification` subsection of the work session block:

```markdown
### YYYY-MM-DD - <title>
status: done | updated: YYYY-MM-DD

#### Verification
- Completeness: N/M (P%)
- Gates: `<exact discovered command>` PASS/FAIL/SKIPPED (repeat per gate)
- Review: Critical 0, Important N, Minor N
- Result: READY TO SHIP / NEEDS WORK / BLOCKED
- Blocking issues: <list, or "none">
```

If `--review` or `--ui-review` is set, add their subsections too.

### Update `status: done` in `.pi/artifacts/TODO.md` and `.pi/artifacts/PLAN.md`

For `TODO.md` prefer the `todo` tool: `todo done "<title>"` (closes the phase, completes remaining items, sets `status: done`). `PLAN.md` has no `todo` tool — edit its `status:` line to `done` in place. Do not move or hide the block.

## 6. Output

Report:
1. Result: **READY TO SHIP** / **NEEDS WORK** / **BLOCKED**
2. Completeness: N/M (P%)
3. Gates table
4. Review findings (if `--review`)
5. UI scores (if `--ui-review`)
6. Blocking issues (or "none")
7. Anchor: `PROGRESS.md#YYYY-MM-DD--<slug>`
8. Audit (if `--audit`): claims proven / gaps found / fake signals

## Related Commands

| Need | Command |
| --- | --- |
| Fix issues found | `/ship <title>` (with the work session block now showing what's left) |
| Re-verify after fixes | `/verify <title>` |
