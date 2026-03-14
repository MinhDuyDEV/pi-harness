---
description: Ship a bead - implement PRD tasks, verify, review, close
---

# Ship: $@

Execute PRD tasks, verify each passes, run review, close the bead.

> **Workflow:** `/create` → `/start <id>` → **`/ship <id>`**
>
> ⛔ Bead MUST be `in_progress` with `prd.md`. Run `/start` first if not.

## Determine Input Type

| Input Type | Detection                   | Action                     |
| ---------- | --------------------------- | -------------------------- |
| Bead ID    | Matches `br-xxx` or numeric | Ship that bead             |
| Path       | File/directory path         | Not supported for ship     |
| `all`      | Keyword                     | Ship all in_progress beads |

## Before You Ship

- **Be certain**: Only ship if all tasks pass verification
- **Don't skip gates**: Build, test, lint, typecheck are non-negotiable
- **Run the review**: Always perform a code review before closing
- **Verify goals**: Tasks completing ≠ goals achieved (use goal-backward verification)
- **Commit before close**: Per-task commits required, don't ship without git history
- **Ask before closing**: Never close bead without user confirmation

## Phase 1: Guards

```bash
br show $@
```

Verify:

- Bead status is `in_progress` (if not, tell user to run `/start $@`)
- `.beads/artifacts/$@/prd.md` exists (if not, tell user to run `/create` first)

Check what artifacts exist:

```bash
ls .beads/artifacts/$@/
```

## Phase 2: Route to Execution

| Artifact exists | Action                                      |
| --------------- | ------------------------------------------- |
| `plan.md`       | Follow its wave-based batch process         |
| `prd.json`      | Proceed to PRD task loop below              |
| Only `prd.md`   | Convert `prd.md` → `prd.json`, then proceed |

## Phase 3: Wave-Based Execution

If `plan.md` exists with dependency graph:

1. **Parse waves** from plan header (Wave 1, Wave 2, etc.)
2. **Execute Wave 1** (independent tasks)
3. **Wait for Wave 1 completion** — all tasks pass or report failures
4. **Execute Wave 2** (depends on Wave 1)
5. **Continue** until all waves complete

### Phase 3A: PRD Task Loop (Sequential Fallback)

For each task (wave-based or sequential fallback):

1. **Read** the task description, verification steps, and affected files
2. **Read** the affected files before editing
3. **Implement** the changes — stay within the task's `files` list
4. **Handle Deviations:** Apply deviation rules 1-4 as discovered
5. **Checkpoint Protocol:** If task has `checkpoint:*`, stop and request user input
6. **Verify** — run each verification step from the task
7. **If verification fails**, fix and retry (max 2 attempts per task)
8. **Commit** — per-task commit (see below)
9. **Mark** `passes: true` in `prd.json`
10. **Append** progress to `.beads/artifacts/$@/progress.txt`

### Checkpoint Protocol

When task has `checkpoint:*` type:

| Type                      | Action                                                     |
| ------------------------- | ---------------------------------------------------------- |
| `checkpoint:human-verify` | Execute automation first, then pause for user verification |
| `checkpoint:decision`     | Present options, wait for selection                        |
| `checkpoint:human-action` | Request specific action with verification command          |

**Automation-first:** If verification CAN be automated, MUST automate it before requesting human check.

**Checkpoint return format:**

```markdown
## CHECKPOINT REACHED

**Type:** [human-verify | decision | human-action]
**Progress:** X/Y tasks complete

### Completed

| Task | Commit | Status |
| ---- | ------ | ------ |
| [N]  | [hash] | [✓/✗]  |

### Current Task

**Task:** [name]
**Blocked by:** [specific blocker]

### Awaiting

[What user needs to do/provide]
```

### TDD Execution Flow

When task specifies TDD:

**RED Phase:**

1. Create test file with failing test
2. Run test → MUST fail
3. Commit: `test: add failing test for [feature]`

**GREEN Phase:**

1. Write minimal code to make test pass
2. Run test → MUST pass
3. Commit: `feat: implement [feature]`

**REFACTOR Phase:** (if needed)

1. Clean up code
2. Run tests → MUST still pass
3. Commit if changes: `refactor: clean up [feature]`

### Task Commit Protocol

After each task completes (verification passed):

1. **Check modified files:** `git status --short`
2. **Stage individually** (NEVER `git add .`):
   ```bash
   git add src/specific/file.ts
   git add tests/file.test.ts
   ```
3. **Commit with type prefix:**

   ```bash
   git commit -m "feat(bead-$@): [task description]

   - [key change 1]
   - [key change 2]"
   ```

4. **Record hash** in progress log

**Commit types:**
| Type | Use For |
|------|---------|
| `feat` | New feature, endpoint, component |
| `fix` | Bug fix, error correction |
| `test` | Test-only changes (TDD RED phase) |
| `refactor` | Code cleanup, no behavior change |
| `chore` | Config, tooling, dependencies |

### Stop Conditions

- Verification fails 2x on same task → stop, report blocker
- Blocked by unfinished dependency → stop, report which one
- Modifying files outside task scope → stop, ask user
- Rule 4 deviation encountered → stop, present options

## Phase 4: Verification Gates

Run the appropriate gates. Default to running all gates unless a reason to skip. Detect project type:

| Project Type    | Detect Via                    | Build            | Test            | Lint                          | Typecheck                             |
| --------------- | ----------------------------- | ---------------- | --------------- | ----------------------------- | ------------------------------------- |
| Node/TypeScript | `package.json`                | `npm run build`  | `npm test`      | `npm run lint`                | `npm run typecheck` or `tsc --noEmit` |
| Rust            | `Cargo.toml`                  | `cargo build`    | `cargo test`    | `cargo clippy -- -D warnings` | (included in build)                   |
| Python          | `pyproject.toml` / `setup.py` | —                | `pytest`        | `ruff check .`                | `mypy .`                              |
| Go              | `go.mod`                      | `go build ./...` | `go test ./...` | `golangci-lint run`           | (included in build)                   |

Check `package.json` scripts, `Makefile`, or `justfile` for project-specific commands first.

Also run PRD `Verify:` commands.

If any gate fails, fix before proceeding.

Recommended gates: **build + test + lint + typecheck** (full validation). Skip only with explicit user request.

## Phase 5: Review

Perform a thorough code review across these dimensions:

- **Security/correctness**: Are there vulnerabilities or logic errors?
- **Performance/architecture**: Are there scalability or design issues?
- **Type-safety/tests**: Are types correct and test coverage adequate?
- **Conventions/patterns**: Does code follow project patterns?
- **Simplicity/completeness**: Is code minimal and complete?

```bash
BASE_SHA=$(git rev-parse origin/main 2>/dev/null || git rev-parse HEAD~1)
HEAD_SHA=$(git rev-parse HEAD)
```

Review the diff from `$BASE_SHA` to `$HEAD_SHA` against the PRD at `.beads/artifacts/$@/prd.md`.

**Auto-fix rule:**

- Critical issues → fix inline, re-run Phase 4 gates, continue
- Important issues → fix inline, continue
- Minor issues → add to bead comments, note for `/compound` step

If review finds critical issues that require architectural decisions → stop → present options to user.

### Goal-Backward Verification (if plan.md exists)

Verify that tasks completed ≠ goals achieved:

**Three-Level Verification:**

| Level              | Check                  | Command/Action                                                    |
| ------------------ | ---------------------- | ----------------------------------------------------------------- |
| **1: Exists**      | File is present        | `ls path/to/file.ts`                                              |
| **2: Substantive** | Not a stub/placeholder | `grep -v "TODO\|FIXME\|return null\|placeholder" path/to/file.ts` |
| **3: Wired**       | Connected and used     | `grep -r "import.*ComponentName" src/`                            |

**Key Link Verification:**

- Component → API: `grep -E "fetch.*api/|axios" Component.tsx`
- API → Database: `grep -E "prisma\.|db\." route.ts`
- Form → Handler: `grep "onSubmit" Component.tsx`
- State → Render: `grep "{stateVar}" Component.tsx`

**Stub Detection:**
Red flags indicating incomplete implementation:

```javascript
return <div>Component</div>      // Placeholder
return <div>{/* TODO */}</div>    // Empty
return null                       // Empty
onClick={() => {}}                // No-op handler
fetch('/api/...')                 // No await, ignored
return Response.json({ok: true})  // Static, not query result
```

If any artifact fails Level 2 or 3 → fix → re-verify.

## Phase 6: Close

All tasks pass, gates green, review clean — confirm with user before closing.

If confirmed:

```bash
br close $@ --reason "Shipped: all PRD tasks pass, verification + review passed"
br sync --flush-only
```

Record significant learnings with `/compound $@` after closing.

## Output

Report:

1. **Execution Summary:**
   - Tasks completed/total
   - Waves executed (if plan.md with waves)
   - Deviations applied (Rules 1-3)
   - Checkpoints encountered (human-verify/decision/human-action)
   - Commits made

2. **PRD Task Results:**
   - Each task status (✓ pass, ✗ fail, ⏸ checkpoint)
   - Files modified per task
   - Commit hashes

3. **Verification Gate Results:**
   - Build: [pass/fail]
   - Test: [pass/fail]
   - Lint: [pass/fail]
   - Typecheck: [pass/fail]

4. **Goal-Backward Verification:**
   - Artifacts verified: [N] exists, [M] substantive, [K] wired
   - Key links checked: [pass/fail per link]
   - Stubs detected: [N] (if any)

5. **Review Summary:**
   - Critical issues: [N]
   - Important issues: [N]
   - Minor issues: [N]
   - Overall assessment: [pass/needs work]

6. **Next Steps:**
   - `/pr` to create pull request
   - Manual commits if not already done
   - Create follow-up beads for deferred work

## Related Commands

| Need        | Command       |
| ----------- | ------------- |
| Create spec | `/create`     |
| Claim task  | `/start <id>` |
| Create PR   | `/pr`         |
