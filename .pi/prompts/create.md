---
description: Create a work session — captures goal, scope, and success criteria as a block in `.pi/artifacts/PLAN.md`
argument-hint: "<title> [--quick] [--ask]"
---

# Create: $ARGUMENTS

Generate a work session spec for the given title. The spec lives as a `### YYYY-MM-DD - <title>` block in `.pi/artifacts/PLAN.md`, with a work session entry in `.pi/artifacts/TODO.md`.

## 1. Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<title>` | required | Short kebab-case title (e.g. `add-rate-limit`, `fix-auth-bug`) |
| `--quick` | false | Skip the confirmation step; write directly |
| `--ask` | false | Ask 1-2 targeted questions even if the request seems clear |

## 2. Gather Context

- Read the user's request from the conversation
- `memory-search` for related prior work (1 call, 3-5 results)
- Check `notes/{ISO-week}.md` for any in-flight context
- If a work session with this title already exists, redirect: "Edit `PLAN.md` instead"

If the request is ambiguous and `--ask` is not set, ask 1-2 focused questions before generating. Do not pad with 5+ questions.

## 3. Generate Spec

The spec is a focused document. Keep it tight; cut anything that doesn't change behavior.

```markdown
## Goal
<one sentence: outcome, not task>

## Scope
**In:** <what's included>
**Out:** <what's explicitly excluded>

## Success Criteria
- <measurable outcome>
- <measurable outcome>

## Constraints
<stack, compatibility, time, scope limits>
```

## 4. Foundation Gate

Before finalizing the spec, answer each in one line and classify the verdict as
`sound`, `repair-first`, or `accepted-risk`:

- Is the current foundation sound for this change, or does it need work first?
- Is each constraint real (verified) or an inherited habit carried over from old specs?
- Does this feature compensate for a foundation flaw? That is a balloon (see `.pi/ANTI_PATTERNS.md`) — spec the foundation fix instead.
- Should foundation work come first as its own work session? If yes, say so in the spec.

Persist the verdict with `workflow_state action=record_foundation`. Use a
write-once record id such as `<date>-<title>-create-foundation-r1`, include
evidence for factual constraints, and classify each constraint as `verified`
or `preference`. If the tool is unavailable, state that the typed checkpoint
was not persisted; do not claim the foundation gate is durable.

## 5. Confirm (skip with `--quick`)

Show the spec summary in 5-10 lines and ask: "Looks right, or adjust?"

## 6. Write Work Session Blocks

### `.pi/artifacts/TODO.md`

If a block with this title exists, edit it. Otherwise, append a new block at the end:

```markdown
### YYYY-MM-DD - <title>
status: active | updated: YYYY-MM-DD

- [ ] /create spec
- [ ] /plan
- [ ] /ship
- [ ] /verify
```

### `.pi/artifacts/PLAN.md`

If a block with this title exists, add or replace its `#### Spec` subsection. Otherwise, append a new block:

```markdown
### YYYY-MM-DD - <title>
status: active | updated: YYYY-MM-DD

#### Spec
<the spec from step 3>

#### Foundation Verdict
- Verdict: sound | repair-first | accepted-risk
- Rationale: <why>
- Evidence: <paths / requirements, or "none">
- Constraints: <each marked verified or preference>
- Workflow record: <record_id and digest, or "not persisted">
```

## 7. Output

Report:
1. Title and date
2. Spec summary (3-5 bullets)
3. Anchor: `PLAN.md#YYYY-MM-DD--<slug>`
4. **Next:** `/plan <title>`

## Related Commands

| Need | Command |
| --- | --- |
| Plan the implementation | `/plan <title>` |
| Research before planning | `/research <topic> --into=<title>` |
