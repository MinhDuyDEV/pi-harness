---
description: Extract and persist learnings from completed work into institutional memory
argument-hint: "[bead-id]"
---

# Compound: $ARGUMENTS

Capture what was learned. This is the flywheel step — each cycle makes the next cycle faster.

> **Workflow:** `/plan` → `/ship` → **`/compound`** → `/pr`
>
> Run after every completed task, review, or PR merge. The value compounds over time.

## Load Skills

```typescript
skill({ name: "memory-system" });
skill({ name: "verification-before-completion" });
```

## What This Does

Extracts learnings from the just-completed work and stores them as structured observations in memory,
so future Plan and Ship cycles start with institutional knowledge instead of blank slates.

## Phase 1: Gather Evidence

```bash
# Get what changed (falls back gracefully if no remote)
git diff origin/main..HEAD --stat 2>/dev/null || git diff HEAD~5..HEAD --stat
git log origin/main..HEAD --oneline 2>/dev/null || git log --oneline -10

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
| `warning`   | A footgun, constraint, or thing that looks wrong but isn't | "Don't modify dist/ directly, build overwrites" |
| `discovery` | A non-obvious fact about the codebase or its dependencies  | "Build copies .pi/ to dist/template/"     |
| `warning`   | Something that will break if not followed                  | "Always run lint:fix before commit"             |

**Quality bar:** Only record learnings that would save future-you 15+ minutes.
Skip obvious things. Skip things already in AGENTS.md.

## Phase 3: Store Observations

For each learning worth keeping, create an observation:

```typescript
observation({
  type: "pattern", // or bugfix, decision, discovery, warning, learning
  title: "[Concise, searchable title — what someone would search for]",
  narrative: "[What happened, why it matters, how to apply it]",
  facts: "[comma, separated, key, facts]",
  concepts: "[searchable, keywords, for, future, retrieval]",
  files_modified: "src/auth/login.ts,src/auth/session.ts",
  confidence: "high", // high=verified, medium=likely, low=speculative
  // ByteRover-inspired quality fields:
  subtitle: "[One-line semantic summary — WHY this matters for future work]",
});
```

**Minimum viable:** title + narrative. Everything else is bonus.

**Quality enrichment:** Add `subtitle` (WHY it matters) for high-impact observations. Skip for routine findings.

## Phase 4: Structural Loss Prevention

When superseding an older observation, prevent accidental knowledge loss.

**Trigger:** Only runs when `supersedes: "ID"` is set on a new observation.

### Step 1: Read the old observation

```typescript
const old = memory-get({ ids: "<superseded-id>" });
```

### Step 2: Detect structural loss

Compare the new observation against the old one:

| Field            | Loss Detection                                                  |
| ---------------- | --------------------------------------------------------------- |
| `facts`          | Old facts not present in new facts (comma-separated comparison) |
| `concepts`       | Old concepts not present in new concepts                        |
| `narrative`      | New narrative significantly shorter than old (< 50% length)     |
| `files_modified` | Old file paths not present in new list                          |

### Step 3: Auto-merge if loss detected

- **Array fields** (facts, concepts): Union merge — keep all old items, add new items, deduplicate
- **Scalar fields** (narrative): If new is shorter, append `\n\n[Preserved from superseded observation #ID:]\n` + old narrative section
- **File paths**: Union merge all paths

### Step 4: Flag for review if high-impact

If the old observation had `confidence: "high"` and the new one has `confidence: "medium"` or `confidence: "low"`, flag with a warning:

> ⚠️ Confidence downgrade detected: superseding a high-confidence observation (#ID) with lower confidence. Verify this is intentional.

**Principle:** Knowledge should accumulate, not be replaced. Merging is safer than overwriting.

## Phase 5: Check AGENTS.md / Skill Updates

Ask: does this learning belong as a permanent rule?

If YES (it's a codebase-level constraint everyone must follow):

- Suggest updating `.pi/memory/project/gotchas.md`
- Or the relevant skill file if it's procedure-level

If MAYBE (it's a pattern, not a rule):

- The observation is sufficient
- Don't pollute AGENTS.md with every finding

**Rule:** AGENTS.md changes require user confirmation. Observations are automatic.

## Phase 6: Update Living Documentation

Check if the shipped work changed architecture, APIs, conventions, or tech stack. If so, update the relevant project docs.

**Check each:**

| Doc                   | Update When                                               | What to Update                                      |
| --------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| `tech-stack.md`       | New dependency added, build tool changed, runtime updated | Dependencies list, build tools, constraints         |
| `project.md`          | Architecture changed, new key files, success criteria met | Architecture section, key files table, phase status |
| `gotchas.md`          | New footgun discovered, constraint found                  | Add the gotcha with context                         |
| `AGENTS.md` (project) | New convention established, boundary rule needed          | Boundaries, gotchas, code example sections          |

```typescript
// Check what changed
// If tech stack changed:
memory-update({ file: "project/tech-stack", content: "...", mode: "append" });
// If new gotcha:
memory-update({ file: "project/gotchas", content: "...", mode: "append" });
```

**Rule:** Only update docs when the change is structural (new pattern, new dep, new constraint). Don't update for routine bug fixes or small features. Ask user before modifying `AGENTS.md`.

## Phase 7: Search for Related Past Observations

```typescript
// Check if this updates or supersedes an older observation
memory-search({ query: "[key concept from the finding]", limit: 3 });
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

## Phase 8: Output Summary

Present extracted learnings for user review before finalizing:

```
## Compound Review

**Work reviewed:** [brief description]
**Learnings extracted:** [N] observations

| # | Type | Title | Impact | Action |
|---|------|-------|--------|--------|
| 1 | pattern | ... | high | ✅ Store |
| 2 | warning | ... | medium | ✅ Store |
| 3 | bugfix | ... | low | ⏭️ Skip (routine) |
```

```typescript
ask_user_question({
  questions: [
    {
      header: "Learnings",
      question: "Review extracted learnings. Store all approved observations?",
      options: [
        { label: "Store all (Recommended)", description: "Persist all marked ✅" },
        { label: "Let me adjust", description: "I'll modify before storing" },
        { label: "Skip compound", description: "Nothing worth persisting" },
      ],
      multiSelect: false,
    },
  ],
});
```

**After approval:** Store observations and report final summary:

```
## Compound Summary

**Observations stored:** [N]
**Superseded:** [N] older observations updated
**AGENTS.md updates suggested:** [yes/no - describe if yes]
**Next recommended:** /pr (or /plan <next-bead-id>)
```

## When Nothing to Compound

If the work was trivial (a config change, 1-line fix with no surprises):

> "Nothing worth compounding. Work was straightforward — no non-obvious patterns, bugs, or decisions encountered."

Don't force observations. Quality over quantity.

## Related Commands

| Need            | Command            |
| --------------- | ------------------ |
| Full chain      | `/lfg`             |
| Review codebase | `/review-codebase` |
| Ship the work   | `/ship`            |
| Curate memory   | `/curate`          |
| Create PR       | `/pr`              |
