---
description: Extract and persist learnings from completed work into institutional memory
argument-hint: "[bead-id]"
---

# Compound: $ARGUMENTS

Capture what was learned. This is the flywheel step — each cycle makes the next cycle faster.

> **Workflow:** `/plan` → `/ship` → `/review` → **`/compound`** → `/pr`
>
> Run after every completed task, review, or PR merge. The value compounds over time.

## What This Does

Extracts learnings from the just-completed work and stores them as structured observations in memory,
so future Plan and Ship cycles start with institutional knowledge instead of blank slates.

## Phase 1: Gather Evidence

```bash
# Get what changed
git diff origin/main..HEAD --stat
git log origin/main..HEAD --oneline

# Get review comments if any
br comments list $ARGUMENTS 2>/dev/null || echo "No bead"

# Get bead context if provided
br show $ARGUMENTS 2>/dev/null || echo "No bead specified"
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
| `discovery` | A non-obvious fact about the codebase or its dependencies  | "Build copies .opencode/ to dist/template/"     |
| `warning`   | Something that will break if not followed                  | "Always run lint:fix before commit"             |

**Quality bar:** Only record learnings that would save future-you 15+ minutes.
Skip obvious things. Skip things already in AGENTS.md.

## Phase 3: Store Observations

For each learning worth keeping, create an observation:

```typescript
observation({
  type: "pattern", // or bugfix, decision, gotcha, discovery, warning
  title: "[Concise, searchable title — what someone would search for]",
  narrative: "[What happened, why it matters, how to apply it]",
  facts: "[comma, separated, key, facts]",
  concepts: "[searchable, keywords, for, future, retrieval]",
  files_modified: "[relevant/file.ts if applicable]",
  confidence: "high", // high=verified, medium=likely, low=speculative
});
```

**Minimum viable:** title + narrative. Everything else is bonus.

## Phase 4: Check AGENTS.md / Skill Updates

Ask: does this learning belong as a permanent rule?

If YES (it's a codebase-level constraint everyone must follow):

- Suggest updating `.opencode/memory/project/gotchas.md`
- Or the relevant skill file if it's procedure-level

If MAYBE (it's a pattern, not a rule):

- The observation is sufficient
- Don't pollute AGENTS.md with every finding

**Rule:** AGENTS.md changes require user confirmation. Observations are automatic.

## Phase 5: Search for Related Past Observations

```typescript
// Check if this updates or supersedes an older observation
memory_search({ query: "[key concept from the finding]", limit: 3 });
```

If a newer finding contradicts or updates an older one, note it:

```typescript
observation({
  type: "decision",
  title: "...",
  narrative: "...",
  supersedes: "42", // ID of the older observation
});
```

## Phase 6: Output Summary

Report what was codified:

```
## Compound Summary

**Work reviewed:** [brief description]
**Learnings captured:** [N] observations

| # | Type      | Title                        | Concepts               |
|---|-----------|------------------------------|------------------------|
| 1 | pattern   | ...                          | auth, jwt              |
| 2 | gotcha    | ...                          | node, build            |
| 3 | bugfix    | ...                          | typecheck, strict-mode |

**AGENTS.md updates suggested:** [yes/no - describe if yes]
**Next recommended:** /pr  (or /plan <next-bead-id>)
```

## When Nothing to Compound

If the work was trivial (a config change, 1-line fix with no surprises):

> "Nothing worth compounding. Work was straightforward — no non-obvious patterns, bugs, or decisions encountered."

Don't force observations. Quality over quantity.

## Related Commands

| Need                   | Command   |
| ---------------------- | --------- |
| Full chain             | `/lfg`    |
| Review before compound | `/review` |
| Ship the work          | `/ship`   |
| Create PR              | `/pr`     |
