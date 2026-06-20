---
description: Create a detailed implementation plan with optional architecture health assessment
argument-hint: "<work-id> [--split] [--architecture]"
agentType: planner
---

# Plan: $ARGUMENTS

Create a detailed, verifiable implementation plan for `.pi/artifacts/<work-id>/SPEC.md`.

> **Workflow:** `/create` → `/plan <id>` (optional for complex work) → `/ship <id>`
>
> Use `--architecture` when the spec involves structural changes that need design review.

## Load Skills

```typescript
skill({ name: "memory-system" });
skill({ name: "behavioral-kernel" });
skill({ name: "planning-and-task-breakdown" });
skill({ name: "deep-module-design" });
skill({ name: "api-and-interface-design" });
```

## Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<work-id>` | required | Directory name under `.pi/artifacts/` |
| `--split` | false | Create phase files under `.pi/artifacts/<id>/phases/` for large work |
| `--architecture` | false | Run architecture health assessment before planning |

## Core Rules

- Keep the plan self-contained under `.pi/artifacts/$ARGUMENTS/`.
- Read `.pi/artifacts/$ARGUMENTS/SPEC.md` before planning.
- Write durable outputs to `.pi/artifacts/$ARGUMENTS/` only.
- Direct tools first; use tmux/self-spawn only when fresh context is worth the overhead.
- Every task must have exact files, proof command, and safety notes.
- Keep tasks vertical: each task should produce a verifiable user- or system-visible outcome.

## Phase 0: Institutional Research (Mandatory)

**Do not skip.** Planning in the dark produces wrong plans.

### Step 1: Load Context

```bash
WORK_DIR=.pi/artifacts/$ARGUMENTS
ls "$WORK_DIR"
[ -f "$WORK_DIR/SPEC.md" ] && sed -n '1,220p' "$WORK_DIR/SPEC.md"
git log --oneline -20
git status --porcelain
```

### Step 2: Search Institutional Memory

```typescript
memory-search({ query: "$ARGUMENTS", limit: 5 });
memory-search({ query: "bugfix|decision|warning", limit: 5 });
```

Incorporate relevant prior decisions, bugfixes, and failed approaches directly into the plan.

### Step 3: Mine Git History

```bash
git log --oneline -20
git log --oneline --all | head -30
git log --oneline -- "src/" --follow 2>/dev/null | head -15
```

Look for: commit conventions, recent changes near your scope, hotfix zones.

If research needs fresh context, write `.pi/artifacts/$ARGUMENTS/RESEARCH-BRIEF.md`, run an explicit tmux/`pi --print-turn` session against that file, and require the result in `.pi/artifacts/$ARGUMENTS/RESEARCH.md` before trusting it.

## Phase 0A: Architecture Assessment (Only with `--architecture`)

Run this before planning when the spec involves cross-cutting structural changes. This phase scans for shallow modules and proposes deep-module improvements.

### Step 1: Scan Module Boundaries

Use direct tools to find architectural weaknesses in affected modules:

```bash
find src -maxdepth 3 -type f 2>/dev/null | sed -n '1,120p'
rg -n "TODO|FIXME" src 2>/dev/null || true
```

Check:
- Interface surface area (export counts, parameter counts)
- Tightly-coupled clusters and high fan-in interfaces
- Long import chains, circular dependencies, duplicate types
- Wrapper-only helper files (shallow modules)

### Step 2: Diagnose

| Module/Area | Interface Size | Complexity Hidden | Depth Score | Issue |
| --- | --- | --- | --- | --- |
| `auth/` | 12 exports | Low | Shallow | Leaks session details |

Depth scoring:
- **Deep**: few exports, hides complexity, callers remain simple.
- **Moderate**: reasonable interface, some leakage.
- **Shallow**: many exports or callers must understand internals.

Focus on the 2-3 highest-leverage shallow modules in the plan's scope.

### Step 3: Propose Design Options

For each selected module, propose the interface improvement:

- Current interface vs proposed interface.
- Prefer the design that deletes code from callers.
- Document blast radius from caller search/read evidence.

### Step 4: Record

Save to `.pi/artifacts/$ARGUMENTS/ARCHITECTURE.md`:

```markdown
# Architecture Assessment: $ARGUMENTS

## Findings
| Module | Score | Issue | Proposed Change |
|--------|-------|-------|-----------------|

## Design Proposals
...

## Blast Radius
...
```

These findings feed into the plan's task definitions and risk assessment.

## Phase 1: Guards

Verify:

- `.pi/artifacts/$ARGUMENTS/SPEC.md` exists — has goal, non-goals, success criteria.
- Existing `.pi/artifacts/$ARGUMENTS/PLAN.md` not overwritten without confirmation.
- Current git tree has no unrelated changes.

```bash
find .pi/artifacts/$ARGUMENTS -maxdepth 2 -type f | sort
```

## Phase 2: Discovery Level

Choose the smallest research depth that makes the plan safe.

| Level | Scope | Use When | Action |
| --- | --- | --- | --- |
| 0 | None | Mechanical/local change with existing patterns | Proceed after code read |
| 1 | Quick | Known library or syntax check | Official docs/source check |
| 2 | Standard | New integration or multiple viable approaches | Research and document findings |
| 3 | Deep | Architecture, data model, security, migration | Produce ADR/spec addendum before tasking |

Depth indicators: Level 2+ if spec references new library, external API, or "choose/evaluate" language. Level 3 if "architecture/design/system", data modeling, or auth design.

## Phase 3: Goal-Backward Analysis

Extract the outcome from `SPEC.md`, then derive what must be true.

### Observable Truths

"What must be TRUE for the goal to be achieved?" List 3-7 truths.

- Must be verifiable by a human using the application or by automated command.
- Include state and recovery coverage (empty, loading, error, success).

### Required Artifacts

For each truth: "What must EXIST for this to be true?"

| Truth | Required Artifacts |
| --- | --- |
| User can see items | ItemList component, Items state, API route, Item type |

### Key Links

"Where is this most likely to break?"

| From | To | Via | Risk |
| --- | --- | --- | --- |
| Component | API | `fetch` | Handler not wired |
| API | Database | query | Returns static, not real result |

## Phase 4: Decompose Work

| Size | Files | Plan Shape |
| --- | --- | --- |
| S | 1-3 | Single `PLAN.md`, 2-4 tasks |
| M | 3-8 | `PLAN.md` with 2-3 phases |
| L | 8+ | `PLAN.md` plus optional `phases/PHASE-*.md` |

Split when: task touches >3 files, discovery/implementation mixed, or checkpoint needed.

### Context Budget

| Task Complexity | Max Tasks | Context/Task | Total |
| --- | --- | --- | --- |
| Simple (CRUD) | 3 | ~10-15% | ~30-45% |
| Complex (auth) | 2 | ~20-30% | ~40-50% |
| Very complex | 1-2 | ~30-40% | ~30-50% |

## Phase 5: Dependency Graph

For each task, record: `needs`, `creates`, `checks`, `scope`, `checkpoint`.

```
Task A: needs nothing → Wave 1
Task B: needs Task A → Wave 2
Task C: needs Task A → Wave 2 (parallel with B)
Task D: needs B + C → Wave 3
```

**Vertical slices preferred** — each task is end-to-end (model + API + UI).

## Phase 6: Write `.pi/artifacts/$ARGUMENTS/PLAN.md`

```markdown
# [Feature] Implementation Plan

**Work ID:** $ARGUMENTS
**Spec:** `.pi/artifacts/$ARGUMENTS/SPEC.md`
**Architecture:** (linked if `--architecture` was used)
**Goal:** [outcome-shaped]
**Discovery Level:** [0-3] - [rationale]
**Context Budget:** [estimate]

## Must-Haves
[Observable truths, required artifacts, key links]

## Dependency Graph
[Tasks and waves]

## Tasks
### Task 1: [vertical slice]
- **Goal:** ...
- **Scope:** `path/a`, `path/b`
- **Steps:** 1. Read files. 2. Tests first. 3. Implement.
- **Verification:** `command` with expected result
```

If `--split`, create `.pi/artifacts/$ARGUMENTS/phases/PHASE-<n>.md`.

## Phase 7: Constitutional Compliance Gate

```bash
PLAN=.pi/artifacts/$ARGUMENTS/PLAN.md
for pattern in "git add ." "git add -A" "--no-verify" "force push" "--force" "reset --hard" "checkout ." "clean -fd"; do
  grep -inF "$pattern" "$PLAN" && echo "VIOLATION: $pattern"
done
```

| Severity | Pattern | Action |
|----------|---------|--------|
| **CRITICAL** | `git add .`, `--force`, `reset --hard`, `checkout .`, `clean -fd` | Remove. Report to user. |
| **WARNING** | New dependency without approval, `as any` without justification | Add approval checkpoint. |

If clean: `Constitutional compliance: PASS`

## Output

Report:

1. Discovery level with rationale.
2. Observable truths and key risks.
3. Architecture findings (if `--architecture`).
4. Task count and dependency waves.
5. Files expected to change.
6. Constitutional compliance: PASS / VIOLATIONS FOUND.
7. Plan path: `.pi/artifacts/$ARGUMENTS/PLAN.md`.
8. Next command: `/ship $ARGUMENTS`.

## Related Commands

| Need | Command |
| --- | --- |
| Create spec | `/create` |
| Research first | `/research <topic-or-id>` |
| Execute plan | `/ship <id>` |
