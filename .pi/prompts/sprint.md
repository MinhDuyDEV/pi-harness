---
description: "Run a structured sprint: Think → Plan → Build → Review → QA → Ship → Reflect"
argument-hint: "<subcommand> [args] — init <title>, status, think, plan, build, review, qa, ship, retro, skip <phase>"
---

# Sprint: $ARGUMENTS

> Think → Plan → Build → Review → QA → Ship → Reflect — state persists in `.beads/sprints/<sprint-id>/state.json`

## Load Skills

```typescript
skill({ name: "sprint" });
```

## Parse Arguments

| Argument | Description |
|----------|-------------|
| `init <title>` | Start a new sprint with the given title |
| `status` | Show sprint dashboard with phase statuses and gates |
| `think` | Run the Think phase (forcing questions + research → design doc) |
| `plan` | Run the Plan phase (multi-perspective review → task breakdown) |
| `build` | Run the Build phase (execute plan tasks) |
| `review` | Run the Review phase (scope drift + plan compliance + code review) |
| `qa` | Run the QA phase (test coverage + edge cases + regression tests) |
| `ship` | Run the Ship phase (pre-flight + changelog + PR) |
| `retro` | Run the Reflect phase (metrics + learnings + sprint grade) |
| `skip <phase>` | Skip a phase with justification (review/qa cannot be skipped) |
| (no args) | Show status if active sprint exists, or prompt to init |

## Phase 0: Resolve Active Sprint

If subcommand is NOT `init`:

```bash
# Read active sprint ID from tracking file
cat .beads/sprints/.active 2>/dev/null
```

If `.active` file doesn't exist or is empty:
- Fallback: scan `.beads/sprints/` for directories, read each `state.json`, find one where `currentPhase !== "done"`
- If still none: Report "No active sprint. Run `/sprint init <title>` to start one." — Stop.

If active sprint found:
- Read `.beads/sprints/<sprint-id>/state.json`
- **Validate state consistency**: verify `currentPhase` matches phase statuses (the current phase should be `in_progress` or the first `pending` phase after all `completed`/`skipped` ones). If mismatch: report the inconsistency and offer to repair by recalculating `currentPhase` from phase statuses.
- Display current phase and available actions

## Route: `init <title>`

1. Generate sprint ID from title: `sprint-YYYY-MM-DD-<slug>` (kebab-case, max 50 chars)
2. Create directory: `mkdir -p .beads/sprints/<sprint-id>`
3. Copy template: `.pi/templates/sprint-state.json` → `.beads/sprints/<sprint-id>/state.json`
4. Detect base branch (multi-strategy):
```bash
# Strategy 1: remote HEAD symref
BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
# Strategy 2: git config default
[ -z "$BASE_BRANCH" ] && BASE_BRANCH=$(git config init.defaultBranch 2>/dev/null)
# Strategy 3: probe common remote branch names
[ -z "$BASE_BRANCH" ] && BASE_BRANCH=$(git branch -r 2>/dev/null | grep -oP 'origin/\K(main|master|develop)' | head -1)
# Strategy 4: fallback
[ -z "$BASE_BRANCH" ] && BASE_BRANCH="main"
```
If all strategies produce an uncertain result, ask the user to confirm.
5. Fill in: `id`, `title`, `created` (ISO-8601), `branch` (from `git branch --show-current`), `baseBranch`
6. Write active sprint tracker: `echo "<sprint-id>" > .beads/sprints/.active`
7. Report:

```
✅ Sprint initialized: <title>
   ID: <sprint-id> | Branch: <branch>
   State: .beads/sprints/<sprint-id>/state.json
   Next: Run `/sprint think` to begin.
```

## Route: `status`

Load sprint skill and display dashboard:
```typescript
skill({ name: "sprint" });
// Follow the Status operation in sprint skill
```

## Route: `think`

1. Verify current phase allows Think (must be `pending` or `in_progress`)
2. Update sprint state: `think.status = "in_progress"`, `think.startedAt = now`
3. Load Think phase skill:
```typescript
skill({ name: "sprint-think" });
```
4. Execute the Think process with sprint context
5. On completion: update state, check gate

## Route: `plan`

1. Verify Think gate: `gates.think-approved === true` (or Think was skipped)
2. If gate not met: "Think phase must be completed first. Run `/sprint think`."
3. Update sprint state: `plan.status = "in_progress"`, `plan.startedAt = now`
4. Load Plan phase skill:
```typescript
skill({ name: "sprint-plan" });
```
5. Execute with design doc as input
6. On completion: update state, check gate

## Route: `build`

1. Verify Plan gate: `gates.plan-approved === true` (or Plan was skipped)
2. If gate not met: "Plan phase must be completed first. Run `/sprint plan`."
3. Update sprint state: `build.status = "in_progress"`, `build.startedAt = now`
4. Load execution skill:
```typescript
skill({ name: "executing-plans" });
```
5. Execute plan tasks. Build has no gate — it's complete when tasks are done.
6. On completion: update state, advance to review

## Route: `review`

1. Verify Build is complete
2. Update sprint state: `review.status = "in_progress"`, `review.startedAt = now`
3. Load Review phase skill:
```typescript
skill({ name: "sprint-review" });
```
4. Execute with plan and diff as input
5. On completion: update state, check gate

## Route: `qa`

1. Verify Review gate: `gates.review-passed === true`
2. If gate not met: "Review phase must pass first. Run `/sprint review`."
3. Update sprint state: `qa.status = "in_progress"`, `qa.startedAt = now`
4. Load QA phase skill:
```typescript
skill({ name: "sprint-qa" });
```
5. Execute QA process
6. On completion: update state, check gate

## Route: `ship`

1. Verify BOTH gates: `review-passed` AND `qa-passed`
2. If either gate not met: Report which gates are missing, how to resolve
3. Update sprint state: `ship.status = "in_progress"`, `ship.startedAt = now`
4. Load Ship phase skill:
```typescript
skill({ name: "sprint-ship" });
```
5. Execute shipping pipeline
6. On completion: update state, advance to reflect

## Route: `retro`

1. Verify Ship is complete (or at least Build, for abandoned sprints)
2. Update sprint state: `reflect.status = "in_progress"`, `reflect.startedAt = now`
3. Load Retro phase skill:
```typescript
skill({ name: "sprint-retro" });
```
4. Execute retrospective
5. On completion: mark sprint as done, clear active tracker: `rm .beads/sprints/.active`

## Route: `skip <phase>`

1. Verify the phase is pending or in_progress
2. Check if phase is skippable:
   - **Can skip**: think, plan, build, reflect
   - **Cannot skip before ship**: review, qa (these are hard gates)
3. If skippable, confirm:

```typescript
question({
  questions: [{
    header: "Skip Phase",
    question: `Skip ${phase}? This means: ${consequences[phase]}`,
    options: [
      { label: "Skip with reason", description: "Provide justification" },
      { label: "Don't skip", description: "Run the phase instead" }
    ]
  }]
})
```

4. If confirmed: set phase `skipped: true`, log decision, advance `currentPhase`

## Related Commands

| Need | Command |
|------|---------|
| Quick brainstorm (no sprint) | `/create` |
| Plan without sprint | `/plan <bead-id>` |
| Review / Ship without sprint | `/review` / `/ship` |
| Research only | `/research` |
