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

Append to `.pi/artifacts/HANDOFF.md` (create if absent) a 12-field context pack. Empty fields stay in with "none" — an absent field is indistinguishable from a forgotten one.

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
- All 12 fields are present (use "none" rather than omitting).

## 5. Report

Tell the user the handoff path + the one-line next step, and (if `--to agent`) the `task` invocation that would resume it.