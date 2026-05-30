---
description: Execute a file-backed work item, verify it, and prepare handoff
argument-hint: "<work-id>"
---

# Ship: $ARGUMENTS

Implement `.pi/plans/<work-id>/SPEC.md` or `.pi/plans/<work-id>/PLAN.md`, verify the result, review the diff, and update the run artifacts.

> **Workflow:** `/create` → `/plan <id>` (optional) → `/ship <id>`

## Load Skills

```typescript
skill({ name: "memory-system" });
skill({ name: "behavioral-kernel" });
skill({ name: "incremental-implementation" });
skill({ name: "verification-before-completion" });
skill({ name: "code-review-and-quality" });
```

## Core Rules

- Direct implementation in this session is the default.
- Use tmux/self-spawn only for independent, file-disjoint work with written prompts and written outputs.
- Keep execution state in `.pi/plans/$ARGUMENTS/` artifacts and current-session notes.
- Read files before editing; verify every meaningful change.
- Never stage with `git add .`; stage explicit files only when the user asks for a commit.
- Do not mix unrelated dirty work into the shipped scope.

## Phase 1: Guards

```bash
WORK_DIR=.pi/plans/$ARGUMENTS
test -d "$WORK_DIR"
test -f "$WORK_DIR/SPEC.md"
find "$WORK_DIR" -maxdepth 2 -type f | sort
git status --porcelain
```

Read, in order when present:

1. `.pi/plans/$ARGUMENTS/SPEC.md`
2. `.pi/plans/$ARGUMENTS/PLAN.md`
3. `.pi/plans/$ARGUMENTS/RESEARCH.md`
4. `.pi/plans/$ARGUMENTS/DESIGN.md`
5. `.pi/plans/$ARGUMENTS/PROGRESS.md`

Create or update `.pi/plans/$ARGUMENTS/RUN-REPORT.md` before implementation begins.

Minimum report fields:

```markdown
# Run Report: $ARGUMENTS

## Status
in_progress

## Inputs
- Spec: `.pi/plans/$ARGUMENTS/SPEC.md`
- Plan: `.pi/plans/$ARGUMENTS/PLAN.md` if present

## Execution Log
| Time | Step | Evidence |
| --- | --- | --- |

## Verification
| Command | Result | Notes |
| --- | --- | --- |

## Files Changed
- TBD
```

## Phase 2: Execution Route

| Artifact | Action |
| --- | --- |
| `PLAN.md` exists | Execute plan tasks/waves in order |
| only `SPEC.md` exists | Derive the smallest safe implementation slice from the spec |
| missing `SPEC.md` | Stop and ask user to run `/create` |

If the plan contains waves:

1. Execute one wave at a time.
2. Multi-task waves are sequential unless tasks are independent and file-disjoint.
3. For tmux/self-spawn, write `.pi/plans/$ARGUMENTS/WORKER-<n>.md` first and require `.pi/plans/$ARGUMENTS/WORKER-<n>-OUTPUT.md` back.
4. Re-read outputs, inspect diffs, and verify before accepting them.

## Phase 3: Task Loop

For each task:

1. State the current slice, out-of-scope items, and proof command.
2. Read the listed files and nearby call sites.
3. Add or update tests first when behavior changes.
4. Implement the smallest working change.
5. Run the task verification command.
6. If verification fails twice on the same approach, stop and report the blocker.
7. Append progress to `.pi/plans/$ARGUMENTS/PROGRESS.md`.
8. Update `.pi/plans/$ARGUMENTS/RUN-REPORT.md` with files changed and evidence.

Checkpoint types:

| Type | Action |
| --- | --- |
| `checkpoint:decision` | Present options and wait |
| `checkpoint:human-verify` | Run automation first, then ask for manual verification |
| `checkpoint:human-action` | Request the exact external action and verification evidence |

## Phase 4: Verification

Follow `verification-before-completion`.

Run project-specific commands first by inspecting `package.json`, `Makefile`, `justfile`, `Cargo.toml`, `pyproject.toml`, or similar.

Minimum evidence:

- Typecheck/lint/test/build as applicable.
- Direct tests for any test file created or modified.
- Goal-backward checks against `SPEC.md` success criteria.
- Diff review scoped to files changed for this work item.

Record exact commands and results in `.pi/plans/$ARGUMENTS/RUN-REPORT.md`.

## Phase 5: Review

Use `code-review-and-quality` in the current session by default.

Review scope:

```bash
git status --short
git diff --stat
git diff
```

Check:

- Correctness against `.pi/plans/$ARGUMENTS/SPEC.md`.
- Security and data-handling risks.
- Type safety and test coverage.
- Simplicity: no speculative abstractions or unrelated cleanup.
- No hidden dependency on external orchestration.

If an independent review is worth the overhead, use a visible tmux/print workflow:

```bash
mkdir -p .pi/plans/$ARGUMENTS
pi --name "review-$ARGUMENTS" --print-turn "Read .pi/plans/$ARGUMENTS/SPEC.md and the current git diff. Write review findings to .pi/plans/$ARGUMENTS/REVIEW.md."
```

Then read `.pi/plans/$ARGUMENTS/REVIEW.md`, verify findings, and fix only scoped issues.

## Phase 6: Handoff

Before claiming done:

- `.pi/plans/$ARGUMENTS/PROGRESS.md` is current.
- `.pi/plans/$ARGUMENTS/RUN-REPORT.md` has fresh verification evidence.
- `git status --short` is understood and unrelated dirty files are called out.
- The final response lists changed files, verification commands, and remaining risks.

Do not commit, push, close, or delete work artifacts unless the user explicitly asks.

## Output

Report:

1. Work ID and artifact paths.
2. Tasks completed and skipped/deferred items.
3. Files changed.
4. Verification commands and results.
5. Review findings and fixes.
6. Next step: `/pr`, commit request, or follow-up work.

## Related Commands

| Need | Command |
| --- | --- |
| Create spec | `/create` |
| Add plan | `/plan <id>` |
| Verify only | `/verify <id>` |
| Create PR | `/pr <id>` |
