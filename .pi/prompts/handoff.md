---
description: Produce a structured handoff document for transferring work to another agent or session — state, decisions, evidence, and next steps — so the receiver continues without re-deriving context. The durable transfer complement to DCP compress.
argument-hint: "<title> [--to <agent|session>] [--resume]"
---

# Handoff: $ARGUMENTS

Resolve `<repo-root>` before using any durable path below: prefer the Git top-level containing both `package.json` and `.pi`; if Git fails or validation fails, walk ancestors from the current directory for that pair. Stop if none exists, then use absolute `<repo-root>/.pi/...` paths.

Compress the current work into a handoff a fresh agent or session can pick up cold. Where DCP compress saves durable state, handoff adds the *transfer contract* — what the receiver must know to continue.

## 1. Parse arguments

| Flag | Default | Meaning |
|------|---------|---------|
| `--to` | `agent` | Receiver: `agent` (a `task` subagent) or `session` (a new Pi session) |
| `--resume` | false | Emit `task_id` / `conversation_id` resume keys for a prior run |

## 2. Gather state

Read `<repo-root>/.pi/artifacts/{TODO,PROGRESS,DECISIONS}.md` and `<repo-root>/.pi/MEMORY.md` for current state, decisions, and evidence. Use `dcp_recall` if context was compacted.

## 3. Write the handoff

Append to `<repo-root>/.pi/artifacts/HANDOFF.md` (create if absent) a 14-field context pack. Empty fields stay in with "none" — an absent field is indistinguishable from a forgotten one.

```
## <title> — <date> — handoff to <receiver>

### Goal
<what the receiver is supposed to accomplish>

### Current state
<where the work stands right now — what exists, what is in flight>

### Verified
<claims already proven, each with evidence — command output or file:line; no self-report>

### Unknowns
<what is unclear or unverified, and what information would resolve it>

### Real constraints
<hard constraints (verified against code/requirements) — separate from mere preferences, labeled as such>

### Relevant files / modules
<the files and modules the receiver will touch or must read first>

### Closed decisions
<decisions that stand, each with rationale — do not reopen without new information>

### Open decisions
<what is undecided and who/what resolves it>

### Existing evidence
<test runs, logs, repro commands, benchmarks already produced — where to find them>

### Expected deliverable
<the concrete artifact or outcome that means "done">

### Permissions (write scope)
<what the receiver may modify; everything else is read-only — includes non-goals / must-not-touch>

### Anti-patterns to avoid
<known failure modes for this work — see `.pi/ANTI_PATTERNS.md` for the shared list>

### Next step
<the concrete first action>

### Resume keys
<task_id / conversation_id if --resume>
```

## 4. Verify

- Every claim under Verified cites evidence (command output or file:line); no self-report.
- The receiver could start from "Next step" alone without re-reading the whole session.
- Open decisions are separated from closed ones; constraints are separated from preferences.
- Write scope is explicit — the receiver knows what they must not touch.
- All 14 fields are present (use "none" rather than omitting).

## 5. Persist typed handoff

Call `workflow_state action=record_handoff` with the same fourteen semantic
sections. Arrays may contain `"none"` when the Markdown section is empty.
Use an immutable record id such as `<date>-<title>-handoff-r1`; an edited
handoff needs a new revision. Record the returned id and digest in
`HANDOFF.md`. If the tool is unavailable, report that typed replay/automation
state was not persisted.

## 6. Report

Tell the user the handoff path + the one-line next step, and (if `--to agent`) the `task` invocation that would resume it.
