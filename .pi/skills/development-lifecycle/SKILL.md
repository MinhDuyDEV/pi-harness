---
name: development-lifecycle
description: >-
  Maps /create, /plan, /ship, /verify, and /research to the canonical
  .pi/artifacts files for a multi-step work session. User-invoked: load via
  /skill:development-lifecycle when managing session artifacts.
metadata:
  version: 2.1.0
  tags:
  - workflow
  - artifacts
  - planning
  - work-sessions
disable-model-invocation: true
---

# Development lifecycle

This is a user-invoked artifact lifecycle skill, not a generic routing alias.
Use it when a session needs durable planning and handoff artifacts.

## Canonical files

| File | Purpose | Touch when |
|---|---|---|
| `.pi/artifacts/TODO.md` | live task list | two or more tool calls/files or multi-step work |
| `.pi/artifacts/PLAN.md` | scope, slices, open questions | new feature, breaking change, ambiguous request |
| `.pi/artifacts/PROGRESS.md` | tried, failed, learned | long investigation/build |
| `.pi/artifacts/DECISIONS.md` | trade-offs/ADRs | two or more viable designs |

`TODO.md` and `PROGRESS.md` entries use
`### YYYY-MM-DD - <title>` plus `status: active|done|abandoned` and an update
date. `artifact-format` owns the detailed grammar.

## Hooks

- `/create <idea>` creates `PLAN.md` and `TODO.md`.
- `/plan` resumes the plan.
- `/ship` runs verification and release hardening.
- `/verify` is the mandatory evidence gate before claiming done.
- `/research` records exploration in `PROGRESS.md` and feeds `/plan` or `/create`.

Update `TODO.md` before the first implementation edit. Do not silently skip a
phase; record why. Keep progress findings in `PROGRESS.md`, decisions in
`DECISIONS.md`, and never put secrets in these artifacts.

## Result

Report phases used, artifact paths touched, verification evidence, skipped
phases, and residual risk. A “done” claim without `/verify` evidence is invalid.
