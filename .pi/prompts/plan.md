---
description: Generate a step-by-step plan for an existing work session — updates the work session block in `<repo-root>/.pi/artifacts/PLAN.md`
argument-hint: "<title> [--split] [--no-adrs] [--quick]"
---

# Plan: $ARGUMENTS

Resolve `<repo-root>` before using any durable path below: prefer the Git top-level containing both `package.json` and `.pi`; if Git fails or validation fails, walk ancestors from the current directory for that pair. Stop if none exists, then use absolute `<repo-root>/.pi/...` paths.

Generate an implementation plan for the work session.

## 1. Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<title>` | required | Work session title (must exist in `TODO.md`) |
| `--split` | false | Break the plan into sequential phases |
| `--no-adrs` | false | Skip ADR generation even if architectural decisions appear |
| `--quick` | false | Skip the confirmation step |

## Ownership boundary
- This prompt owns slash arguments, artifact transitions, and the next command. Load `planning-and-task-breakdown` for planning method, risk ordering, and dependency reasoning; do not duplicate that skill's detailed workflow here.

## 2. Find Work Session

Use the available repository text/semantic search tool to locate the exact `### ... - <title>` block in `<repo-root>/.pi/artifacts/TODO.md`; do not assume `rg` is installed.

If not found: "Run `/create <title>` first."

## 3. Read Spec

Read the `#### Spec` subsection of the work session block in `PLAN.md`. If DCP is loaded, use `dcp_recall` once for related prior work; otherwise inspect the current artifact files directly. Read the relevant codebase.

## 4. Generate Plan

A sequence of steps. Each step:

```markdown
## Step N: <name>
- **Action:** <one concrete change — file + action>
- **Verify:** <how to confirm it works>
- **Risk:** <what could go wrong>
```

Use `--split` to group steps into phases when the work has natural sequencing (data → API → UI, schema → query → handler, etc.). Each phase gets its own `#### Phase N: <name>` subsection.

Number of steps should match the size of the work. Don't pad with ceremony steps. Don't under-spec a 10-file change with 3 vague steps.

## 5. Foundation Gate

Before finalizing the plan, answer each in one line and classify the verdict as
`sound`, `repair-first`, or `accepted-risk`:

- Is the current foundation sound for this change, or does it need work first?
- Is each constraint real (verified against code/requirements) or an inherited habit?
- Does any step compensate for a foundation flaw? That is a balloon (see `.pi/ANTI_PATTERNS.md`) — plan the foundation fix instead.
- Should foundation work be sequenced as the first steps? If yes, reorder before confirming.

Persist this plan-stage verdict with
`workflow_state action=record_foundation` and a new immutable record id such as
`<date>-<title>-plan-foundation-r1`. Evidence factual constraints; label
preferences as preferences. Record the returned id and digest in the
`#### Foundation Verdict` subsection. If the tool is unavailable, report that
the typed checkpoint is missing rather than treating prose as equivalent.

## 6. Confirm (skip with `--quick`)

Show the plan, then use `ask_user` for one focused choice: accept, adjust (text), or cancel. If `ask_user` is unavailable or the session is non-TUI, ask the same choices as a numbered plain-text question and wait. Skip this interaction only with `--quick`.

## 7. Update Blocks

### `<repo-root>/.pi/artifacts/PLAN.md`

Add a `#### Plan` subsection (and `#### Phases` if `--split`) to the work session block. If the block doesn't exist yet, create it with the Spec carried over.
Add or replace `#### Foundation Verdict` with verdict, rationale, evidence,
constraint classifications, and the immutable workflow record id/digest.

### `<repo-root>/.pi/artifacts/TODO.md`

Replace the slash-command checkboxes with one checkbox per step. Keep `/verify` at the bottom.

```markdown
### YYYY-MM-DD - <title>
status: active | updated: YYYY-MM-DD

- [ ] Step 1: <name>
- [ ] Step 2: <name>
- [ ] /verify
```

### `<repo-root>/.pi/artifacts/DECISIONS.md`

If the plan involves real architectural choices (alternative considered, tradeoffs, why-this-not-that), append a block for this work session. Skip with `--no-adrs`.

```markdown
### YYYY-MM-DD - <title>
status: active | updated: YYYY-MM-DD

#### ADR 001: <decision title>
**Context:** <what forced the choice>
**Decision:** <what we chose>
**Consequences:** <tradeoffs and follow-ups>
```

Number ADRs sequentially (`001`, `002`, ...) within the work session block. If multiple, repeat the H4 pattern.

## 8. Output

Report:
1. Number of steps (and phases if `--split`)
2. ADRs written (count, list titles)
3. Anchor: `PLAN.md#YYYY-MM-DD--<slug>`
4. **Next:** `/ship <title>`

## Related Commands

| Need | Command |
| --- | --- |
| Implement the plan | `/ship <title>` |
| Verify after implementation | `/verify <title>` |
