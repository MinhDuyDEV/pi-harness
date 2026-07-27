# HerdR integration notes (migrated)

> **Historical note.** This file used to hold the author's HerdR-specific delegation doctrine
> (pane placement by task shape, claim serialization before launch, `workspace_group`/`batch_id`
> grouping, lifecycle-state-as-hint, the attention broker, `task_control` surface, and durable
> state paths), originally extracted from `.pi/APPEND_SYSTEM.md`. That content now lives with the
> runtime that implements it, `@minhduydev/pi-subagents`, and was intentionally never injected
> into the portable runtime here.

Where it went:

- Operational recipes (pane/workspace placement, pane-race fix, grouped completion, writer
  discipline defaults): `skills/pi-subagents/references/herdr-room.md` in `@minhduydev/pi-subagents`,
  linked from the skill body — load `/skill:pi-subagents`.
- Machine contract (`task_control` actions, human `/task-*` commands, durable state under
  `.pi/artifacts/tasks/orchestration/`, evidence and learning-claim rules):
  `skills/pi-subagents/SKILL.md` and `skills/pi-subagents/references/contract.md` in the same package.

Consumers of pi-harness without HerdR can ignore this file entirely.
