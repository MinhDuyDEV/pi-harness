---
name: planning-and-task-breakdown
description: Use when a feature/change has a spec or clear goal and needs an executable implementation plan.
version: 1.0.0
tags: [workflow, planning, agent-coordination]
dependencies: [spec-driven-development]
agent_types: [planner]
tools: [TaskCreate, TaskUpdate, memory, grep, find, read]
---

# Planning & Task Breakdown

## When to Use

- Have a spec, PRD, ADR, or clear feature goal.
- Implementation spans >1 file, >1 session, or >1 worker.
- Need an executable plan a human or subagent can follow.

## When NOT to Use

- Single-function fixes; mechanical refactors with obvious verification.
- No spec exists yet — use `brainstorming` first.
- Trivial one-liner with no acceptance criteria.

## Core Principle

**Lead with what is most-likely to change** (data model, type interfaces, UX). Mechanical refactor last. Stable parts of the plan go at the bottom; volatile parts at the top. If a section of the plan survives contact with implementation, it should be at the bottom.

## Workflow

1. **Spec interview** — ask the questions the spec leaves open (data model, edge cases, non-goals, success criteria). One question at a time for non-obvious decisions.
2. **Slice** — break work into vertical (tracer-bullet) slices via `incremental-implementation`. Each slice is independently verifiable.
3. **Order** — most-likely-to-change first, mechanical refactor last. Risk-first when integration is unknown.
4. **Risks + verification** — for each slice, name the verification command and the risk of getting it wrong.
5. **Stop conditions** — for parallel work, define who stops whom on conflict.

## Slice Quality

| Good slice | Bad slice |
|---|---|
| One complete path through all layers | One layer in isolation |
| Independently verifiable (test/build/check passes) | Untestable until all layers done |
| Adds user-visible behavior or fixes a bug | Pure prep with no signal |
| Reverts cleanly | Tangles with unrelated code |

## Plan Template

```
## Goal
[1 sentence]

## Non-goals
[explicit exclusions]

## Slices (ordered)
1. <slice> — verify: <cmd> — risk: <what>
2. ...

## Open questions
[must-resolve before slice N]

## Stop conditions
[who blocks whom, on what]
```

## Red Flags

- Plan starts with "setup" / "scaffold" / "infrastructure" — that's horizontal, not vertical.
- Slice acceptance is "looks right" instead of a concrete command.
- No explicit non-goals — scope will creep.
- Mechanical refactor (rename, reformat) appears in slice 1 — moves the goalposts.
- Risks only listed at the end, not per slice.
- Open questions outnumber slices — spec is incomplete, go back to brainstorming.

## Skill Result Contract

```xml
<skill_result>
  <skill>planning-and-task-breakdown</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Spec gaps filled, slices defined and ordered, verification commands named</evidence>
  <artifacts>Plan document or section</artifacts>
  <risks>Unresolved open questions, unverified slices, or none</risks>
</skill_result>
```
