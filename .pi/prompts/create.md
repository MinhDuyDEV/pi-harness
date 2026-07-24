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

## 4. Confirm (skip with `--quick`)

Show the spec summary in 5-10 lines and ask: "Looks right, or adjust?"

## 5. Write Work Session Blocks

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
```

## 6. Output

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
