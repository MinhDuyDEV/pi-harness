---
name: sprint
description: Use to run structured sprints with phase gates and artifact tracking (Think → Plan → Build → Review → QA → Ship → Reflect).
version: 1.0.0
tags: [workflow, orchestration, sprint]
dependencies: [sprint-think, sprint-plan, sprint-review, sprint-qa, sprint-ship, sprint-retro, executing-plans]
---

# Sprint Orchestrator

## When to Use
- Starting a new feature or project that benefits from structured phases
- You want enforced quality gates between think, plan, build, review, QA, ship
- You need artifact traceability (design doc → plan → review log → retro)
- Working on anything non-trivial that takes more than a single session

## When NOT to Use
- Quick bug fixes or typo corrections (just fix them)
- Pure research or exploration (use `/research` or brainstorming directly)
- You're mid-sprint already (use `/sprint status` to resume)
- Lightweight feature work where phases would be overhead — use `/skill:development-lifecycle` instead (simpler linear flow, no state persistence or gates)

## Overview

A sprint is a stateful workflow that chains 7 phases with artifact handoffs and quality gates. Sprint state persists in `.beads/sprints/<sprint-id>/state.json` so work survives across sessions.

**Phase chain:** Think → Plan → Build → Review → QA → Ship → Reflect

Each phase produces artifacts the next phase consumes. Gates prevent skipping critical checkpoints.

## Sprint State

State file: `.beads/sprints/<sprint-id>/state.json`
Template: `.pi/templates/sprint-state.json`

Read state at the start of every sprint operation. Write state after every phase transition.

### Phase Statuses
- `pending` — Not yet started
- `in_progress` — Currently active
- `completed` — Finished and gate passed
- `skipped` — Explicitly skipped by user (with reason logged)

### Gates (Required Checkpoints)
| Gate | Required Before | What It Checks |
|------|----------------|----------------|
| `think-approved` | Plan phase | User approved design doc |
| `plan-approved` | Build phase | User approved implementation plan |
| `review-passed` | Ship phase | All critical review issues resolved |
| `qa-passed` | Ship phase | All tests passing |

## Operations

### Init (`/sprint init <title>`)
1. Generate sprint ID: `sprint-YYYY-MM-DD-<slug>`
2. Create directory: `.beads/sprints/<sprint-id>/`
3. Copy `.pi/templates/sprint-state.json` → `state.json`, fill in id, title, created, branch
4. Report: "Sprint initialized. Run `/sprint think` to begin."

### Status (`/sprint status`)
1. Read `state.json` from most recent sprint (or specified sprint-id)
2. Display dashboard:
```
Sprint: <title> (<id>)
Branch: <branch> | Bead: <bead-id or "none">

Phase       Status      Artifacts           Gate
─────       ──────      ─────────           ────
Think       ✅ done     design.md           ✅ approved
Plan        ✅ done     plan.md             ✅ approved
Build       🔄 active   —                   —
Review      ⏳ pending  —                   ⬜ not checked
QA          ⏳ pending  —                   ⬜ not checked
Ship        ⏳ pending  —                   —
Reflect     ⏳ pending  —                   —

Current: Build | Next gate: review-passed
```

### Advance (automatic)
When a phase skill completes and its gate passes:
1. Update phase status → `completed`, record `completedAt`
2. Log transition in `metrics.phaseTransitions` as `{"from": "<phase>", "to": "<phase>", "timestamp": "ISO-8601"}`
3. Advance `currentPhase` to next phase
4. Report next phase and what it requires

### Skip (`/sprint skip <phase>`)
1. Confirm with user: "Skipping <phase> means <consequence>. Continue?"
2. If confirmed: set phase `skipped: true`, add skip reason to decisions log
3. Advance to next phase
4. **Cannot skip**: review or qa gates if ship phase requires them

## Phase Routing

When user invokes a phase (e.g., `/sprint think`):
1. Read sprint state
2. Verify phase is current or next (no jumping ahead past gates)
3. Load the phase skill: `/skill:sprint-think`, `/skill:sprint-plan`, etc.
4. For Build phase: load `/skill:executing-plans` directly (no sprint-build skill needed)
5. On phase completion: update state, check gate, advance

## Decision Classification

Throughout all phases, classify every decision:
- **Mechanical**: Clear best answer from evidence — decide silently, log to decisions array
- **Taste**: Multiple valid approaches — surface at next gate for user input
- **User Challenge**: Affects user workflow, values, or scope — ask immediately

## Artifact Chain

```
Think  → design.md        (problem, research, approach, premises)
Plan   → plan.md          (tasks, waves, test strategy, dependencies)
Build  → [code changes]   (implementation following plan)
Review → review-log.jsonl (findings, fixes, scope drift notes)
QA     → qa-report.md     (test results, coverage, edge cases)
Ship   → changelog.md     (version, changes, PR link)
Reflect → retro.md        (metrics, learnings, observations)
```

All artifacts stored in `.beads/sprints/<sprint-id>/`.

## Integration

- **Active sprint tracking**: `.beads/sprints/.active` contains current sprint ID. Written by init, cleared by retro.
- **Resume across sessions**: Read `.active` to find current sprint, load state
- **Memory**: After reflect phase, key learnings become memory observations
- **Beads**: Link sprint to bead via `beadId` field when bead is created during Plan phase
- **Existing skills**: Build phase delegates to `executing-plans`, review enhances `requesting-code-review`
