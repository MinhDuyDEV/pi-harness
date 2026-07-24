---
description: Produce a structured handoff document for transferring work to another agent or session — state, decisions, evidence, and next steps — so the receiver continues without re-deriving context. The durable transfer complement to DCP compress.
argument-hint: "<title> [--to <agent|session>] [--resume]"
---

# Handoff: $ARGUMENTS

Compress the current work into a handoff a fresh agent or session can pick up cold. Where DCP compress saves durable state, handoff adds the *transfer contract* — what the receiver must know to continue.

## 1. Parse arguments

| Flag | Default | Meaning |
|------|---------|---------|
| `--to` | `agent` | Receiver: `agent` (a `task` subagent) or `session` (a new Pi session) |
| `--resume` | false | Emit `task_id` / `conversation_id` resume keys for a prior run |

## 2. Gather state

Read `.pi/artifacts/{TODO,PROGRESS,DECISIONS}.md` and `.pi/MEMORY.md` for current state, decisions, and evidence. Use `dcp_recall` if context was compacted.

## 3. Write the handoff

Append to `.pi/artifacts/HANDOFF.md` (create if absent) a section:

```
## <title> — <date> — handoff to <receiver>

### Goal
<what the receiver is supposed to accomplish>

### State
<done so far, with evidence — cite file:line or commands run>

### Decisions
<decisions that stand, each with rationale; mark open decisions separately>

### Open decisions / unknowns
<what is undecided and what information would resolve it>

### Non-goals
<what the receiver must NOT touch>

### Next step
<the concrete first action>

### Resume keys
<task_id / conversation_id if --resume>
```

## 4. Verify

- Every "done" claim cites evidence (command output or file:line); no self-report.
- The receiver could start from "Next step" alone without re-reading the whole session.
- Open decisions are separated from decided ones.

## 5. Report

Tell the user the handoff path + the one-line next step, and (if `--to agent`) the `task` invocation that would resume it.