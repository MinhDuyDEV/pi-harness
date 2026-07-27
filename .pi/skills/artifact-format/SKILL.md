---
name: artifact-format
description: Defines the format and lifecycle of .pi/artifacts/TODO.md, PLAN.md, PROGRESS.md, and DECISIONS.md. Use when starting any non-trivial task, recording status, or deciding where an update belongs.
metadata:
  version: 1.0.0
  tags:
  - workflow
  - artifacts
  - planning
---

# Artifact Format

## When

Required when ANY of: ≥ 2 tool calls, ≥ 2 files modified, audit/plan/review output, behavior or policy change, or any work the user might want to review later. Skip only for: single-line edits, trivial config values, direct Q&A with no durable output.

## Files

Default: `TODO.md` for most non-trivial work. Promote to `PLAN.md` when there is a real design choice. Promote to `PROGRESS.md` only when work spans multiple turns/sessions. Add `DECISIONS.md` only when a real architectural tradeoff was made.

One task = one primary file. Cross-reference by heading anchor, do not duplicate content.

Canonical paths:

- `.pi/artifacts/TODO.md`
- `.pi/artifacts/PLAN.md`
- `.pi/artifacts/PROGRESS.md`
- `.pi/artifacts/DECISIONS.md`

## Format

Each task is a `### YYYY-MM-DD - <title>` block with a `status:` line:

    ### 2026-06-23 - fix rate limit
    status: active | updated: 2026-06-23

    - [ ] step 1
    - [ ] step 2

Status values: `active`, `done`, `abandoned`. Include `updated: YYYY-MM-DD` on every transition. Use `|` as the separator (greppable, not `·`).

For `DECISIONS.md` use `### YYYY-MM-DD - ADR NNN: <title>` with a numbered counter, e.g. `### 2026-06-17 - ADR 001: <title>`. Read the file first; NNN is the next available integer. This file only defines the block format — the ADR content structure (context, decision, consequences, alternatives) is owned by the `documentation-and-adrs` skill.

## Operations

Two operations only:

- **Append** a new `###` block at the end of the file.
- **Edit** the `status:` line in place. Do not move, hide, or redact blocks. Tasks stay in chronological order in a single file.

When status changes from `active`, edit the line in place. The block stays in the file. Old work is just greppable, not archived.

## View

To see current work across all four files:

    rg '^status: active' .pi/artifacts/{TODO,PLAN,PROGRESS,DECISIONS}.md

To see all entries for a date or project:

    rg '^### 2026-06-23' .pi/artifacts/TODO.md

## References

Cross-file references use heading anchors:

    TODO.md#2026-06-23-fix-rate-limit

Anchors are slugified lowercase with hyphens. Em dashes and spaces become single hyphens. Do not use other punctuation in titles.

## Concurrency

Artifacts are owned by the parent agent. Subagents (`task`) return proposed blocks to the parent; the parent writes to the canonical file.

`task` sessions may write their own transcripts under `.pi/artifacts/tasks/`; treat those as implementation detail logs. The parent should still translate durable outcomes into the canonical artifact files as needed.

## Work Sessions

A work session is a multi-phase task that goes through `/create`, `/plan`, `/ship`, `/verify` (and optionally `/research`). Each slash command updates the same `### YYYY-MM-DD - <title>` block across the relevant canonical files. Sub-content within a block uses H4 (`#### Spec`, `#### Plan`, `#### Run Report`, etc.).

See `superpi` for lifecycle routing and the slash command → file mapping.

## Anti-rationalization

| Shortcut the model reaches for | Why it fails here |
|---|---|
| "It's a quick task, skip the TODO block" | "Quick" is the task that grows; the block costs one append + saves the untracked drift. |
| "I'll add it when it gets complex" | By the time it's complex, the early steps are unrecorded; append at the start. |
| "It's just bookkeeping" | Bookkeeping is the value — the block makes multi-step work observable + resumable; skip it + the work is invisible. |

## Lifecycle

Files grow monotonically. When any canonical file exceeds 1000 lines OR contains blocks older than 90 days marked `done`, rotate it to `.pi/artifacts/_archive/<TYPE>-<YEAR>.md` and start a new file with a one-line header pointing to the archive.

If rotation would happen mid-task, finish the task first; rotate on the next turn.
