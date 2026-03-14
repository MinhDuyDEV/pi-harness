---
description: Full autonomous chain - Plan → Ship → Review → Compound in one command
---

# LFG (Let's Fucking Go): $@

Full compound engineering cycle. One command, all four steps.

> **When to use:** You have a bead in `in_progress` state with a PRD. You want maximum autonomous execution with minimum hand-holding.
>
> **Checkpoints happen** at decision points. Everything automatable is automated.

## Parse Arguments

| Argument      | Default  | Description                             |
| ------------- | -------- | --------------------------------------- |
| `<bead-id>`   | required | The bead to execute                     |
| `--skip-plan` | false    | Skip planning if plan.md already exists |

## Phase 0: Preflight

```bash
br show $1
ls .beads/artifacts/$1/
```

Verify:

- Bead exists and is `in_progress`
- `prd.md` exists
- If `plan.md` exists and `--skip-plan` not set: ask user whether to replan or use existing

Report:

```
## LFG: <bead-id> — <title>

Cycle: Plan → Ship → Review → Compound
Plan: [create new / use existing]
```

## Step 1: PLAN

Create a detailed implementation plan for this bead:

- Read the PRD at `.beads/artifacts/$1/prd.md`
- Research any unknowns in the codebase
- Identify task dependencies and group into waves
- Output plan to `.beads/artifacts/$1/plan.md`

Checkpoint if plan has major unknowns or architecture questions. Otherwise proceed automatically.

## Step 2: WORK

Execute the plan wave-by-wave:

- Load `plan.md` and parse waves
- Execute each wave's tasks sequentially, verifying each task before moving on
- Per-task commits after each task passes verification

Run verification after each wave:

- `npm run typecheck`
- `npm run lint`
- `vitest` (if tests exist for changed areas)

Checkpoint only at `checkpoint:human-verify` or `checkpoint:decision` tasks.

## Step 3: REVIEW

```bash
BASE_SHA=$(git rev-parse origin/main 2>/dev/null || git rev-parse HEAD~$(git log --oneline | wc -l | tr -d ' '))
HEAD_SHA=$(git rev-parse HEAD)
```

Review the diff from `$BASE_SHA` to `$HEAD_SHA` across these dimensions:

- Security/correctness
- Performance/architecture
- Type-safety/tests
- Conventions/patterns
- Simplicity/completeness

**Auto-fix rule:**

- Critical issues → fix inline, re-verify, continue
- Important issues → fix inline, continue
- Minor issues → add to bead comments, continue

If critical issues cannot be auto-fixed:

```
## CHECKPOINT: Review Blocker

Critical issue found that requires architectural decision:
[description]

Options:
1. [option A]
2. [option B]

Awaiting your decision before continuing.
```

## Step 4: COMPOUND

Extract learnings from the full cycle:

- Review what files changed (`git diff origin/main..HEAD --stat`) and what patterns were used
- Identify non-obvious decisions, bugs found, patterns confirmed, or gotchas discovered
- For each learning worth keeping (saves 15+ min future work): note the type (pattern, bugfix, decision, gotcha, discovery, warning), title, and narrative
- Check project notes for related past observations and note if any are superseded
- Suggest updates to `docs/gotchas.md` if a codebase-level constraint was discovered (requires user confirmation)

## Step 5: Report & Next

```
## LFG Complete: <bead-id>

### Cycle Summary

| Step     | Status | Notes                        |
|----------|--------|------------------------------|
| Plan     | ✓      | [N] waves, [M] tasks         |
| Work     | ✓      | [N] commits, [M] files       |
| Review   | ✓      | [M] fixes                    |
| Compound | ✓      | [N] learnings captured       |

### Learnings Captured
[list of learning titles]

### Verification
- typecheck: pass
- lint: pass
- tests: pass ([N] passing)

### Next Steps
- Review the changes: `git diff origin/main`
- Create PR: `/pr`
- Or continue with next bead: `/lfg <next-bead-id>`
```

## Related Commands

| Need            | Command            |
| --------------- | ------------------ |
| Plan only       | `/plan <id>`       |
| Ship only       | `/ship <id>`       |
| Review only     | `/review-codebase` |
| Compound only   | `/compound <id>`   |
| Create PR after | `/pr`              |
