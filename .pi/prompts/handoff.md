---
description: Save progress and context for next session
---

# Handoff: $@

Save state so the next session can pick up cleanly.

> **Workflow:** Run this when pausing work. Resume with `/resume $@`.

## Parse Arguments

| Argument         | Default  | Description                        |
| ---------------- | -------- | ---------------------------------- |
| `<bead-id>`      | required | The bead to hand off               |
| `[instructions]` | none     | Extra context for the next session |

---

## Phase 1: Gather State

```bash
br show $@
git status --porcelain
git branch --show-current
git rev-parse --short HEAD
ls .beads/artifacts/$@/ 2>/dev/null
```

---

## Phase 2: Handle Uncommitted Changes

If `git status` shows uncommitted changes, decide what to do:

- **Commit as WIP (recommended):** commit all changes now so the next session starts from a clean state
- **Leave uncommitted:** skip the commit and just write the handoff notes

If committing:

```bash
git add -A
git commit -m "WIP: $@ - [brief description of where you stopped]"
```

---

## Phase 3: Write Handoff

Create the directory if needed and write the handoff file:

```bash
mkdir -p .beads/artifacts/$@/handoffs
```

Write the following content to `.beads/artifacts/$@/handoffs/$(date +%Y-%m-%dT%H-%M-%S).md`:

```
# Handoff: $@

**Date:** [timestamp]
**Branch:** [from git branch]
**Commit:** [from git rev-parse]

## Done
- [completed work]

## In Progress
- [current step] — stopped because [reason]

## Remaining
- [next steps]

## Files Touched
- `path/to/file.ts` — [what changed]

## Decisions
- [decision]: [why]

## Blockers
[any blockers, or "None"]

## Resume Instructions
1. [first thing to do]
2. [second thing to do]

Resume with: `/resume $@`
```

---

## Phase 4: Record Learnings (If Any)

If you discovered patterns or gotchas worth remembering, add a "Learnings" section to the handoff file:

```
## Learnings
- [concise, searchable title]: [what you learned — specific and actionable]
  Keywords: [relevant concepts]
```

---

## Phase 5: Sync

```bash
br sync --flush-only
```

---

## Output

```
Handoff: $@
━━━━━━━━━━━━━━━━━━━

Branch: [branch]
Commit: [hash]
Saved:  .beads/artifacts/$@/handoffs/[timestamp].md

Next session: /resume $@
```
