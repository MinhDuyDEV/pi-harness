---
description: Create a detailed implementation plan for a file-backed work item
argument-hint: "<work-id> [--split]"
agentType: planner
---

# Plan: $ARGUMENTS

Create a detailed, verifiable implementation plan for `.pi/plans/<work-id>/SPEC.md`.

> **Workflow:** `/create` → `/plan <id>` (optional for complex work) → `/ship <id>`
>
> Use this when the spec is clear but execution needs sequencing, discovery, or TDD steps.

## Load Skills

```typescript
skill({ name: "memory-system" });
skill({ name: "behavioral-kernel" });
skill({ name: "planning-and-task-breakdown" });
```

## Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<work-id>` | required | Directory name under `.pi/plans/` |
| `--split` | false | Create phase files under `.pi/plans/<id>/phases/` for large work |

## Core Rules

- Do not use external task trackers or orchestration CLIs.
- Read `.pi/plans/$ARGUMENTS/SPEC.md` before planning.
- Write durable outputs to `.pi/plans/$ARGUMENTS/` only.
- Direct tools first; use tmux/self-spawn only when fresh context is worth the overhead.
- Every task must have exact files, proof command, and rollback/safety notes.
- Keep tasks vertical: each task should produce a verifiable user- or system-visible outcome.

## Phase 0: Institutional Research

Load what the repository already knows before planning.

```bash
WORK_DIR=.pi/plans/$ARGUMENTS
ls "$WORK_DIR"
[ -f "$WORK_DIR/SPEC.md" ] && sed -n '1,220p' "$WORK_DIR/SPEC.md"
git log --oneline -20
srcwalk overview . 2>/dev/null || true
srcwalk discover "$ARGUMENTS" 2>/dev/null || true
```

Search memory for relevant bugfixes, prior plans, and constraints. Incorporate useful findings directly into the plan and avoid re-solving settled decisions.

If research needs fresh context, write `.pi/plans/$ARGUMENTS/RESEARCH-BRIEF.md`, run an explicit tmux/`pi --print-turn` session against that file, and require the result in `.pi/plans/$ARGUMENTS/RESEARCH.md` before trusting it.

## Phase 1: Guards

Verify:

- `.pi/plans/$ARGUMENTS/SPEC.md` exists.
- Existing `.pi/plans/$ARGUMENTS/PLAN.md` is not overwritten without user confirmation.
- The spec has goal, non-goals, success criteria, and verification expectations.
- The current git tree has no unrelated changes that would be mixed into implementation.

```bash
git status --porcelain
find .pi/plans/$ARGUMENTS -maxdepth 2 -type f | sort
```

## Phase 2: Discovery Level

Choose the smallest research depth that makes the plan safe.

| Level | Scope | Use When | Action |
| --- | --- | --- | --- |
| 0 | None | Mechanical/local change with existing patterns | Proceed after code read |
| 1 | Quick | Known library or syntax check | Official docs/source check |
| 2 | Standard | New integration or multiple viable approaches | Research and document findings |
| 3 | Deep | Architecture, data model, security, migration | Produce ADR/spec addendum before tasking |

Ask the user before doing Level 3 work unless they already requested deep planning.

## Phase 3: Goal-Backward Analysis

Extract the outcome from `SPEC.md`, then derive what must be true.

```markdown
## Must-Haves

### Observable Truths
1. [Human- or system-verifiable truth]

### Required Artifacts
| Artifact | Provides | Path |
| --- | --- | --- |

### Key Links
| From | To | Via | Risk |
| --- | --- | --- | --- |
```

Tasks should satisfy these truths, not merely modify files.

## Phase 4: Decompose Work

Target small verified slices.

| Size | Files | Plan Shape |
| --- | --- | --- |
| S | 1-3 | Single `PLAN.md`, 2-4 tasks |
| M | 3-8 | `PLAN.md` with 2-3 phases |
| L | 8+ | `PLAN.md` plus optional `phases/PHASE-*.md` with dependencies |

Split when:

- A task touches more than 3 files.
- Discovery and implementation are mixed.
- UI, persistence, API, and tests all change together.
- A checkpoint or user decision is required.

## Phase 5: Dependency Graph

For each task, record:

- `needs`: prerequisites.
- `creates`: files or behavior produced.
- `checks`: exact commands/manual checks.
- `scope`: exact files allowed.
- `checkpoint`: decision/human verification if needed.

Example:

```markdown
Task A: needs nothing; creates src/models/item.ts; checks npm test -- item
Task B: needs Task A; creates src/api/items.ts; checks npm test -- api/items
Task C: needs Task B; creates src/components/ItemList.tsx; checks npm test -- ItemList

Wave 1: A
Wave 2: B
Wave 3: C
```

## Phase 6: Write `.pi/plans/$ARGUMENTS/PLAN.md`

Required structure:

```markdown
# [Feature] Implementation Plan

**Work ID:** $ARGUMENTS
**Spec:** `.pi/plans/$ARGUMENTS/SPEC.md`
**Goal:** [outcome-shaped]
**Discovery Level:** [0-3] - [rationale]
**Context Budget:** [estimate]

## Must-Haves
[Observable truths, artifacts, key links]

## Dependency Graph
[Tasks and waves]

## Tasks

### Task 1: [vertical slice]
- **Goal:** ...
- **Scope:** `path/a`, `path/b`
- **Steps:**
  1. Read exact files.
  2. Add/modify tests first when behavior changes.
  3. Implement smallest change.
- **Verification:** `command` with expected result
- **Failure policy:** stop after two failed attempts on same approach
```

If `--split` is used, also create `.pi/plans/$ARGUMENTS/phases/PHASE-<n>.md` and link those files from the main plan.

## Phase 7: Safety Gate

Scan the plan for forbidden patterns before execution:

```bash
PLAN=.pi/plans/$ARGUMENTS/PLAN.md
grep -inF "git add ." "$PLAN" || true
grep -inF "git add -A" "$PLAN" || true
grep -inF -- "--no-verify" "$PLAN" || true
grep -inF "force push" "$PLAN" || true
grep -inF -- "--force" "$PLAN" || true
grep -inF "reset --hard" "$PLAN" || true
grep -inF "checkout ." "$PLAN" || true
grep -inF "clean -fd" "$PLAN" || true
```

Critical findings must be removed before reporting the plan as ready.

## Output

Report:

1. Discovery level and rationale.
2. Must-have truths and key risks.
3. Task count and dependency waves.
4. Files expected to change.
5. Plan path: `.pi/plans/$ARGUMENTS/PLAN.md`.
6. Next command: `/ship $ARGUMENTS`.

## Related Commands

| Need | Command |
| --- | --- |
| Create spec | `/create` |
| Research first | `/research <topic-or-id>` |
| Execute plan | `/ship <id>` |
