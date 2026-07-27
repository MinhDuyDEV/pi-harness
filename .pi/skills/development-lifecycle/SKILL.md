---
name: development-lifecycle
description: Maps the session lifecycle commands — /create, /plan, /ship, /verify, /research — onto the artifact files in .pi/artifacts/. Use when starting, planning, shipping, or verifying a session.
metadata:
  version: 2.0.0
  tags:
  - workflow
  - artifacts
  - planning
  - work-sessions
---

# Development Lifecycle

## The 4 Canonical Artifact Files

At `.pi/artifacts/`, maintained in the working copy:

| File | Purpose | Use when |
|---|---|---|
| `TODO.md` | Live task list per session / day | >=2 tool calls OR >=2 files OR multi-step work |
| `PLAN.md` | Long-form spec, slice ordering, open questions | New feature, breaking change, ambiguous spec |
| `PROGRESS.md` | Per-iteration log: tried, failed, learned | Long-running investigation or build |
| `DECISIONS.md` | ADRs (Architecture Decision Records) | Real trade-off between two or more viable options |

**Entry format (TODO.md, PROGRESS.md):** `### YYYY-MM-DD - <title>` followed by `status: active | done | abandoned | updated: <date>`.

The full file spec and entry grammar are owned by the `artifact-format` skill — this skill only decides when each file is touched.

## Slash Commands (Lifecycle Hooks)

- `/create <idea>` — turn a rough idea into a `PLAN.md` and `TODO.md`. Loaded from `brainstorming` + `spec-driven-development`.
- `/plan` — open / resume the current plan. Loaded from `planning-and-task-breakdown`.
- `/ship` — pre-merge hardening: tests, lint, types, format. Loaded from `shipping-and-launch`.
- `/verify` — claim-completion evidence gate. Loaded from `verification-before-completion`.
- `/research` — exploratory investigation; lives in `PROGRESS.md`. Loaded from `spec-driven-development`.

## Workflow

```
   /create  ──>  /plan  ──>  implement  ──>  /ship  ──>  /verify
      │            │           │              │           │
   PLAN.md      TODO.md      artifacts    tests/lint    evidence
   TODO.md      updates      PROGRESS.md  green        claim holds
```

**`/research` is sideways** — it feeds `/plan` or `/create`, not the linear path.

## When to Use Each Phase

| Phase | Trigger | Skip if |
|---|---|---|
| `/create` | New feature / product / PRD | Trivial one-liner |
| `/plan` | Multi-file change, ambiguous spec | Single known file, clear spec |
| `/ship` | Before merge / commit | No code change this session |
| `/verify` | Before "done" claim, always | Never skip |
| `/research` | Open-ended question, no answer path | The answer is in the code or docs already |

## Lifecycle Rules

1. **No silent skipping** — if you skip a phase, name it in the response ("skipped /plan: single-file fix with clear spec"). This becomes the audit trail.
2. **Update TODO.md first, then code** — append the entry before the first edit. Re-reading it on resume gives you the state.
3. **PROGRESS.md = investigation log** — failed attempts and "what I tried" go here, not in chat.
4. **DECISIONS.md is for trade-offs, not choices** — if there's only one viable option, it goes in PLAN.md as a fact, not an ADR.
5. **/verify is non-negotiable** — every "done" claim cites evidence.

## Tool integration

When the `todo` tool is available (the `pi-todo` extension is pinned), lifecycle commands prefer it for TODO.md mutations: `/ship` and `/verify` use `todo start "<step>"` / `todo done "<step>"` per step and `todo done "<title>"` to close the phase. `/create` and `/plan` still bulk-write the markdown directly (pi-todo's file watcher reconciles external edits). `PLAN.md` / `PROGRESS.md` / `DECISIONS.md` have no `todo` tool — edit them in place.

## Red Flags

- TODO.md has no `### YYYY-MM-DD - <title>` entries — likely stale or skipped.
- PROGRESS.md empty on a multi-hour task — context loss on resume.
- DECISIONS.md used as a dumping ground for any choice — noise, not signal.
- "Done" claim without `/verify` evidence — common regression.

## Skill Result Contract

```xml
<skill_result>
  <skill>development-lifecycle</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Phase(s) used named, artifact files updated, /verify evidence cited</evidence>
  <artifacts>TODO.md / PLAN.md / PROGRESS.md / DECISIONS.md paths touched</artifacts>
  <risks>Skipped phases, stale entries, or none</risks>
</skill_result>
```
