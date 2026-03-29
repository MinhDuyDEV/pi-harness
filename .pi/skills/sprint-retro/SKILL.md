---
name: sprint-retro
description: Use during sprint Reflect phase to analyze sprint metrics, capture learnings, grade the sprint, and store insights in memory.
version: 1.0.0
tags: [workflow, sprint, retrospective, learning]
dependencies: []
---

# Sprint Retro

## When to Use
- Sprint Ship phase is complete — code is merged/PR created
- You want to capture what went well, what didn't, and what to improve
- End of any significant development effort, even if not a formal sprint

## When NOT to Use
- Sprint isn't done yet (finish Ship first)
- Trivial change that doesn't warrant reflection

## Overview

Retro closes the learning loop. Without it, the same mistakes repeat across sprints. This phase analyzes metrics, captures insights, and stores learnings in memory so future sprints benefit.

**Input**: All sprint artifacts + git history
**Output**: `.beads/sprints/<sprint-id>/retro.md` + memory observations

## The Process

### Step 1: Gather Raw Data

```
Read: .beads/sprints/<sprint-id>/state.json → extract baseBranch (default: "main") as BASE_REF
```

```bash
# Code metrics
git diff $BASE_REF...HEAD --stat
git log $BASE_REF..HEAD --oneline --format="%h %s (%cr)"
git log $BASE_REF..HEAD --shortstat --format=""

# Review findings
Read: .beads/sprints/<sprint-id>/review-log.jsonl (if exists)

# QA results
Read: .beads/sprints/<sprint-id>/qa-report.md (if exists)

# Test coverage
npm test -- --coverage 2>&1 || true
```

### Step 2: Sprint Metrics

Calculate and display:

```
Sprint: <title> (<id>)
Duration: <start> → <end> (<N> hours/days)

Phase Timing:
  Think:   <duration> | Artifacts: design.md
  Plan:    <duration> | Artifacts: plan.md
  Build:   <duration> | Artifacts: <N files changed>
  Review:  <duration> | Findings: <N critical>, <M informational>
  QA:      <duration> | Tests added: <N>, Coverage: <before>% → <after>%
  Ship:    <duration> | Commits: <N>
  Reflect: (now)

Code Impact:
  Files changed:    <N>
  Lines added:      <N>
  Lines removed:    <N>
  Tests added:      <N>
  Functions added:  <N>
  Functions modified: <N>
```

### Step 3: Phase Analysis

For each phase, assess efficiency:

**Think**: Was the design doc useful? Did we deviate from it? If so, was that good (adapted to reality) or bad (didn't think enough)?

**Plan**: Was the task breakdown accurate? How many tasks were added/removed during Build? Was the wave structure useful?

**Build**: How long did implementation take vs estimate? Were there surprises? What was the hardest part?

**Review**: How many critical issues were found? Were they things Plan should have caught? Any scope drift?

**QA**: How many edge cases were found? Were tests adequate before QA phase? Coverage change.

**Ship**: Was it smooth? Any last-minute issues? Did pre-flight checks catch anything?

### Step 4: What Went Well

Identify 3-5 things that worked:
- Decisions that saved time
- Patterns that prevented bugs
- Tools or processes that helped
- Collaborations that were effective

### Step 5: What Didn't Go Well

Identify 3-5 things to improve:
- Time sinks or bottlenecks
- Issues found late that should have been caught early
- Scope changes or miscommunications
- Technical debt incurred

### Step 6: Decision Log Review

Read the sprint's decisions from state.json:
```json
{
  "decisions": [
    { "phase": "think", "type": "taste", "decision": "...", "rationale": "..." }
  ]
}
```

Which decisions were correct? Which would you change? This is the most valuable part of the retro — calibrating future judgment.

### Step 7: Sprint Grade

Rate the sprint on 5 dimensions (1-5):

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Planning accuracy** | /5 | Did the plan match reality? |
| **Code quality** | /5 | Review findings severity and count |
| **Test coverage** | /5 | Coverage delta and edge case handling |
| **Shipping smoothness** | /5 | How clean was the Ship phase? |
| **Learning velocity** | /5 | Did we learn and adapt during the sprint? |

**Overall: X/25**

### Step 8: Capture Learnings in Memory

For each significant learning, create a memory observation:

```
observation({
  type: "learning",
  title: "<Concise learning>",
  narrative: "<Details and context>",
  concepts: "sprint, <relevant-tech>, <pattern-name>"
})
```

For important decisions that should influence future work:
```
observation({
  type: "decision",
  title: "<Decision made>",
  narrative: "<Context, options considered, rationale>",
  concepts: "sprint, architecture, <area>"
})
```

### Step 9: Write Retro & Close Sprint

Save retro to `.beads/sprints/<sprint-id>/retro.md` with sections: Metrics, Phase Analysis, What Went Well, What Didn't, Decision Review, Grade (X/25), Action Items (3 specific improvements).

Update sprint state:
- `reflect.status = "completed"`
- `currentPhase = "done"`
- `metrics.completedAt = now`
- `metrics.totalTimeMinutes` = calculate from first phase `startedAt` to `metrics.completedAt`

Clear active sprint tracker: `rm .beads/sprints/.active`

Report: "Sprint complete. Learnings stored in memory. Action items logged."

## After Retro
Sprint is complete. Start a new sprint with `/sprint init <next-title>`.
