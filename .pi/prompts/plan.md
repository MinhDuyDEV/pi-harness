---
description: Generate a step-by-step plan for an existing work session — updates the work session block in `.pi/artifacts/PLAN.md`
argument-hint: "<title> [--split] [--no-adrs] [--quick]"
agentType: planner
---

# Plan: $ARGUMENTS

Generate an implementation plan for the work session.

## 1. Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<title>` | required | Work session title (must exist in `TODO.md`) |
| `--split` | false | Break the plan into sequential phases |
| `--no-adrs` | false | Skip ADR generation even if architectural decisions appear |
| `--quick` | false | Skip the confirmation step |

## 2. Find Work Session

```bash
rg "^### .* - <title>$" .pi/artifacts/TODO.md
```

If not found: "Run `/create <title>` first."

## 3. Read Spec

Read the `#### Spec` subsection of the work session block in `PLAN.md`. Run `memory-search` for related prior work (1 call, 3-5 results). Read the relevant codebase.

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

## 5. Confirm (skip with `--quick`)

Show the plan and confirm.

## 6. Update Blocks

### `.pi/artifacts/PLAN.md`

Add a `#### Plan` subsection (and `#### Phases` if `--split`) to the work session block. If the block doesn't exist yet, create it with the Spec carried over.

### `.pi/artifacts/TODO.md`

Replace the slash-command checkboxes with one checkbox per step. Keep `/verify` at the bottom.

```markdown
### YYYY-MM-DD - <title>
status: active | updated: YYYY-MM-DD

- [ ] Step 1: <name>
- [ ] Step 2: <name>
- [ ] /verify
```

### `.pi/artifacts/DECISIONS.md`

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

## 7. Output

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
