---
description: Execute a file-backed work item, verify, review, commit, and prepare PR handoff
argument-hint: "<work-id> [--pr]"
---

# Ship: $ARGUMENTS

Implement `.pi/artifacts/<work-id>/SPEC.md` or `PLAN.md`, verify the result, review the diff, commit, and optionally create a PR.

> **Workflow:** `/create` → `/plan <id>` (optional) → `/ship <id>` → `/ship --pr <id>` (optional)

## Load Skills

```typescript
skill({ name: "memory-system" });
skill({ name: "behavioral-kernel" });
skill({ name: "incremental-implementation" });
skill({ name: "verification-before-completion" });
skill({ name: "code-review-and-quality" });
skill({ name: "git-workflow-and-versioning" });
```

## Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<work-id>` | required | Directory under `.pi/artifacts/` |
| `--pr` | false | After shipping, also create a pull request |

## Core Rules

- Direct implementation in this session is the default.
- Use tmux/self-spawn only for independent, file-disjoint work with written prompts and written outputs.
- Keep execution state in `.pi/artifacts/$ARGUMENTS/` artifacts and current-session notes.
- Read files before editing; verify every meaningful change.
- Never stage with `git add .`; stage specific files only.
- Do not mix unrelated dirty work into the shipped scope.
- Tasks completing ≠ goals achieved. Always verify against the spec, not just task checklists.

## Phase 1: Guards

```bash
WORK_DIR=.pi/artifacts/$ARGUMENTS
test -d "$WORK_DIR" || { echo "No artifact directory. Run /create first."; exit 1; }
test -f "$WORK_DIR/SPEC.md" || { echo "No SPEC.md found."; exit 1; }
find "$WORK_DIR" -maxdepth 2 -type f | sort
git status --porcelain
git branch --show-current
```

Search memory for failed approaches to avoid repeating.

Read, in order when present:

1. `.pi/artifacts/$ARGUMENTS/SPEC.md`
2. `.pi/artifacts/$ARGUMENTS/PLAN.md`
3. `.pi/artifacts/$ARGUMENTS/RESEARCH.md`
4. `.pi/artifacts/$ARGUMENTS/DESIGN.md`
5. `.pi/artifacts/$ARGUMENTS/PROGRESS.md`

Create or reset `.pi/artifacts/$ARGUMENTS/RUN-REPORT.md` before execution begins:

```markdown
# Run Report: $ARGUMENTS

**Started:** [timestamp]
**Status:** in_progress

## Inputs
- Spec: `.pi/artifacts/$ARGUMENTS/SPEC.md`
- Plan: `.pi/artifacts/$ARGUMENTS/PLAN.md` (if present)

## Execution Log
| Time | Step | Evidence |
|------|------|----------|

## Verification
| Command | Result | Notes |
|---------|--------|-------|

## Files Changed
- TBD
```

## Phase 2: Execution Route

| Artifact found | Action |
|----------------|--------|
| `PLAN.md` exists | Parse plan header + dependency graph, execute wave-by-wave |
| Only `SPEC.md` exists | Derive the smallest safe implementation slice from the spec |
| Missing `SPEC.md` | Stop and ask user to run `/create` |

### Wave-Based Execution (from PLAN.md)

If `PLAN.md` has a dependency graph with waves:

1. Parse waves from the graph.
2. Execute wave-by-wave:
   - Single-task wave → execute directly.
   - Multi-task wave → run tasks sequentially (pikit default for reliability) unless tasks are file-disjoint.
3. After each wave, update RUN-REPORT.md and PROGRESS.md.
4. Continue until all waves complete.

### Direct Execution (SPEC.md only)

If no PLAN.md exists:

1. Read the spec's tasks and success criteria.
2. Execute tasks in spec order.
3. Skip decision checkpoints — flag them instead.

## Phase 3: Task Loop

For each task:

### 3a: Setup

- State the task goal, out-of-scope items, and proof command.
- Read listed files and nearby call sites.
- If task has `checkpoint:*` type, prepare automation first.

### 3b: Implement

- Add or modify tests first when behavior changes (TDD RED → GREEN → REFACTOR).
- Implement the smallest working change.
- Stay within the task's `scope`/`files` list.

### 3c: Verify

- Run each task verification command.
- If verification fails twice on the same approach, stop and report the blocker.
- If `checkpoint:human-verify`, run automation, then present findings for confirmation.
- If `checkpoint:decision`, present options and wait.

### 3d: Record Progress & Commit

Append to `.pi/artifacts/$ARGUMENTS/PROGRESS.md`:

```markdown
### Task N: [name] — ✓ or ✗

**Files changed:**
- `path/to/file`: [what changed]

**Verification:**
- `command` → [exit code] [evidence]

**Notes:**
- ...
```

Update `.pi/artifacts/$ARGUMENTS/RUN-REPORT.md` with files changed and evidence.

**Optional per-task commit.** When committing:

1. **Inspect:** `git status --porcelain`
2. **Stage specific files** relevant to this logical change only (never `git add .`).
3. **Determine type:**
   - `feat`: new feature or capability
   - `fix`: bug fix
   - `refactor`: code restructuring without behavior change
   - `test`: test-only changes (TDD RED phase)
   - `chore`: config, tooling, dependencies
4. **Commit:** `git commit -m "type: [task description]" -m "[why, not what]"`

Rules:
- Subject line: max 72 chars, imperative mood.
- Body: explain why, not what.
- No emoji.
- Do not bypass hooks.
- Leave unrelated changes unstaged.

### Checkpoint Types

| Type | Action |
| --- | --- |
| `checkpoint:decision` | Present options and wait |
| `checkpoint:human-verify` | Run automation first, then ask for manual verification |
| `checkpoint:human-action` | Request the exact external action and verification evidence |

## Phase 4: Verification

### Step 1: Gates

Follow `verification-before-completion`. Minimum evidence:

- Typecheck / lint / test / build as applicable.
- Direct tests for any test file created or modified.

### Step 2: Goal-Backward Verification

**Tasks completed ≠ goals achieved.** Verify against the spec's success criteria.

#### Three-Level Artifact Check

| Level | Check | Command |
|-------|-------|---------|
| 1: Exists | File is present | `ls path/to/file.ts` |
| 2: Substantive | Not a stub/placeholder | `grep -v "TODO\|FIXME\|return null\|placeholder" path/to/file.ts` |
| 3: Wired | Connected and used | `grep -r "import.*ComponentName" src/` |

#### Key Link Verification

| Link | Check |
|------|-------|
| Component → API | `grep -E "fetch.*api/\|axios" Component.tsx` |
| API → Database | `grep -E "prisma\.\|db\." route.ts` |
| Form → Handler | `grep "onSubmit" Component.tsx` |
| State → Render | `grep "{stateVar}" Component.tsx` |

#### Stub Detection

Red flags indicating incomplete implementation:

- `return <div>Component</div>` — placeholder
- `return null` — empty
- `onClick={() => {}}` — no-op handler
- `fetch('/api/...')` without `.then()` or `await` — fire-and-forget
- `return Response.json({ok: true})` — static, not query result

If any task artifact fails Level 2 or 3, fix and re-verify.

### Step 3: Record

Write fresh verification evidence to `.pi/artifacts/$ARGUMENTS/RUN-REPORT.md`.

## Phase 5: Review

Use `code-review-and-quality` in the current session by default.

```bash
git status --short
git diff --stat
git diff
```

Check:

- Correctness against `.pi/artifacts/$ARGUMENTS/SPEC.md`.
- Security and data-handling risks.
- Type safety and test coverage.
- Simplicity: no speculative abstractions or unrelated cleanup.
- No hidden dependency on external orchestration.

Critical issues → fix inline, re-verify, continue.
Important issues → fix inline, continue.
Minor issues → note in RUN-REPORT.md.

If an independent review is worth the overhead, use a visible tmux/print workflow:

```bash
pi --name "review-$ARGUMENTS" --print-turn "Read .pi/artifacts/$ARGUMENTS/SPEC.md and the current git diff. Write review findings to .pi/artifacts/$ARGUMENTS/REVIEW.md."
```

Then read output, verify findings, and fix only scoped issues.

## Phase 6: Close

### Pre-close Checklist

- [ ] `.pi/artifacts/$ARGUMENTS/PROGRESS.md` is current with all tasks recorded.
- [ ] `.pi/artifacts/$ARGUMENTS/RUN-REPORT.md` has fresh verification evidence.
- [ ] Goal-backward checks passed.
- [ ] `git status --short` is clean (or unrelated dirty files are explicitly called out).
- [ ] Review: no critical or important issues remain.

### Ask About Next Steps

```typescript
ask_user_question({
  questions: [
    {
      header: "Complete",
      question: "All tasks pass, gates green, review clean. What next?",
      options: [
        { label: "Mark complete (Recommended)", description: "All checks passed, done for now" },
        { label: "Create PR", description: "Push branch and create pull request" },
        { label: "Make more changes", description: "Continue working" },
      ],
      multiSelect: false,
    },
  ],
});
```

### Option: Create PR

If the user selects "Create PR" (or `--pr` flag was passed), follow the PR flow:

1. **Check repository:** `git branch --show-current`
2. **Verify CLI:** `command -v gh >/dev/null 2>&1 || echo "gh CLI not found"`
3. **Push:** `git push -u origin $(git branch --show-current)`
4. **Create PR:**

```bash
git log main...HEAD --oneline 2>/dev/null || git log --oneline -10
BASE_SHA=$(git rev-parse origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || git rev-parse HEAD~1)
HEAD_SHA=$(git rev-parse HEAD)
```

```bash
gh pr create --title "[$ARGUMENTS] [summary]" --body "$(cat <<PRBODY
## Summary

[1-2 sentences: what this PR does and why]

## Changes

- \`path/to/file\`: [what changed]

## Testing

- [command]: [result]

## Artifacts

- Spec: \`.pi/artifacts/$ARGUMENTS/SPEC.md\`

## Checklist

- [x] Tests added/updated where needed
- [x] Verification gates pass
- [x] Review completed
PRBODY
)"
```

If it's a draft: add `--draft`.

Report: PR URL and status (ready/draft).

## Output

Report:

1. **Work ID** and artifact paths.
2. **Execution summary**: tasks completed, skipped/deferred, waves executed.
3. **Files changed**: list with changes per file.
4. **Verification**: gate results, goal-backward checks, stub detection.
5. **Review findings**: critical, important, minor.
6. **Commits**: per-task commits if created.
7. **PR URL**: if created.

## Related Commands

| Need | Command |
| --- | --- |
| Create spec | `/create` |
| Add plan | `/plan <id>` |
| Verify only | `/verify <id>` |
