---
description: Extract and persist learnings from completed work into project notes
---

# Compound: $@

Capture what was learned. This is the flywheel step — each cycle makes the next cycle faster.

> **Workflow:** `/plan` → `/ship` → `/review-codebase` → **`/compound`** → `/pr`
>
> Run after every completed task, review, or PR merge. The value compounds over time.

## What This Does

Extracts learnings from the just-completed work and documents them as structured notes,
so future Plan and Ship cycles start with institutional knowledge instead of blank slates.

## Phase 1: Gather Evidence

```bash
# Get what changed
git diff origin/main..HEAD --stat
git log origin/main..HEAD --oneline

# Get review comments if any
br comments list $@ 2>/dev/null || echo "No bead"

# Get bead context if provided
br show $@ 2>/dev/null || echo "No bead specified"
```

Collect from all available sources:

- Git diff (what files changed, what patterns were used)
- Bead comments (review findings, decisions made)
- Current session context (what was discovered, what was hard)
- Any error messages that were solved

## Phase 2: Classify Learnings

For each finding, assign a type:

| Type        | When to Use                                                | Example                                         |
| ----------- | ---------------------------------------------------------- | ----------------------------------------------- |
| `pattern`   | A reusable approach confirmed to work in this codebase     | "Always use X pattern for Y type of component"  |
| `bugfix`    | A non-obvious bug and its root cause                       | "Bun doesn't support X, use Y instead"          |
| `decision`  | An architectural or design choice with rationale           | "Chose JWT over sessions because..."            |
| `gotcha`    | A footgun, constraint, or thing that looks wrong but isn't | "Don't modify dist/ directly, build overwrites" |
| `discovery` | A non-obvious fact about the codebase or its dependencies  | "Build step copies templates to dist/"          |
| `warning`   | Something that will break if not followed                  | "Always run lint:fix before commit"             |

**Quality bar:** Only record learnings that would save future-you 15+ minutes.
Skip obvious things. Skip things already in AGENTS.md.

## Phase 3: Document Learnings

For each learning worth keeping, document it with:

- **Type**: one of the types above
- **Title**: concise, searchable (what someone would search for)
- **Narrative**: what happened, why it matters, how to apply it
- **Facts**: comma-separated key facts
- **Concepts**: searchable keywords for future retrieval
- **Files**: relevant file paths if applicable
- **Confidence**: high (verified), medium (likely), or low (speculative)

Write these to a `learnings.md` file in `.beads/artifacts/$@/` if a bead is active, or present them inline in the output.

**Minimum viable:** title + narrative. Everything else is bonus.

## Phase 4: Check Project Notes Updates

Ask: does this learning belong as a permanent rule?

If YES (it's a codebase-level constraint everyone must follow):

- Suggest updating `docs/gotchas.md`
- Or the relevant skill file if it's procedure-level

If MAYBE (it's a pattern, not a rule):

- The documented learning is sufficient
- Don't pollute AGENTS.md with every finding

**Rule:** AGENTS.md and project notes changes require user confirmation. Inline learnings are automatic.

## Phase 5: Check for Related Past Learnings

Check project notes if available for related observations or decisions. If a newer finding contradicts or updates an older one, note explicitly which older learning is superseded and why.

## Phase 6: Output Summary

Report what was codified:

```
## Compound Summary

**Work reviewed:** [brief description]
**Learnings captured:** [N]

| # | Type      | Title                        | Concepts               |
|---|-----------|------------------------------|------------------------|
| 1 | pattern   | ...                          | auth, jwt              |
| 2 | gotcha    | ...                          | node, build            |
| 3 | bugfix    | ...                          | typecheck, strict-mode |

**Project notes updates suggested:** [yes/no - describe if yes]
**Next recommended:** /pr  (or /plan <next-bead-id>)
```

## When Nothing to Compound

If the work was trivial (a config change, 1-line fix with no surprises):

> "Nothing worth compounding. Work was straightforward — no non-obvious patterns, bugs, or decisions encountered."

Don't force learnings. Quality over quantity.

## Related Commands

| Need                   | Command            |
| ---------------------- | ------------------ |
| Full chain             | `/lfg`             |
| Review before compound | `/review-codebase` |
| Ship the work          | `/ship`            |
| Create PR              | `/pr`              |
