---
description: Organize, deduplicate, and curate knowledge in project memory
argument-hint: "[--scope recent|all] [--auto-merge]"
---

# Curate: $ARGUMENTS

Organize accumulated knowledge. Surface conflicts, merge duplicates, archive stale observations.

> **Workflow:** `/ship` → `/compound` → **`/curate`** → `/pr`
>
> Run periodically (weekly or after major work) to keep memory sharp. Inspired by ByteRover's structured curation pipeline.

## Load Skills

```typescript
skill({ name: "memory-system" });
skill({ name: "verification-before-completion" });
```

## Parse Arguments

| Argument       | Default  | Description                                      |
| -------------- | -------- | ------------------------------------------------ |
| `--scope`      | `recent` | `recent` = last 30 days, `all` = entire memory   |
| `--auto-merge` | false    | Auto-merge exact duplicates without confirmation |

## Phase 1: Inventory

Take stock of current memory state:

```typescript
memory-admin({ operation: "status" });
memory-admin({ operation: "capture-stats" });
```

Report:

```
## Memory Inventory

| Metric | Count |
|--------|-------|
| Total observations | [N] |
| Recent (30 days) | [N] |
| By type | pattern: N, decision: N, bugfix: N, ... |
| Confidence distribution | high: N, medium: N, low: N |
```

## Phase 2: Domain Detection

Analyze observations to extract semantic domains — groups of related knowledge.

```typescript
// Get memory status for inventory
memory-admin({ operation: "status" });

// Search by common concept categories to build domain map
const domains = [];
for (const concept of ["build", "test", "memory", "git", "agent", "auth", "ui", "config"]) {
  const results = memory-search({ query: concept, limit: 20 });
  // Group results by concept affinity
}
```

Categorize observations into domains based on their `concepts` and `title` fields:

| Domain         | Example Concepts                   | Observation Count |
| -------------- | ---------------------------------- | ----------------- |
| `build_system` | build, tsdown, rsync, dist         | [N]               |
| `testing`      | vitest, test, TDD, coverage        | [N]               |
| `memory`       | observation, FTS5, sqlite, handoff | [N]               |
| `git_workflow` | commit, branch, push, PR           | [N]               |
| `agent_system` | subagent, delegation, skills       | [N]               |

**Domain naming rules:**

- snake_case, 1-3 words
- Semantically meaningful (not just "misc")
- Maximum 10 domains (merge small groups)

## Phase 3: Conflict & Duplicate Detection

### 3a. Exact Duplicates

```typescript
memory-admin({ operation: "lint" });
```

Flag observations with identical or near-identical titles and narratives. Present for merge:

```
### Duplicates Found

| Obs A | Obs B | Similarity | Recommended Action |
|-------|-------|------------|-------------------|
| #12 "Use JWT for auth" | #45 "JWT chosen for auth" | 95% title match | MERGE → keep #45 (newer) |
| #8 "Build copies .pi/" | #33 "Build copies .pi/" | 100% title match | MERGE → keep #33 (newer) |
```

### 3b. Contradictions

Search for observations where:

- Same concepts but different decisions
- Same file paths but conflicting patterns
- Confidence downgrade without supersedes link

```
### Contradictions Found

| Obs A | Obs B | Conflict | Recommended Action |
|-------|-------|----------|-------------------|
| #5 "Always use X pattern" | #29 "Avoid X pattern" | Opposite recommendations | RESOLVE — ask user which is current |
```

### 3c. Stale Observations

Flag observations where:

- Referenced files no longer exist
- Referenced patterns no longer appear in codebase
- Over 90 days old with no related recent activity

```
### Stale Observations

| Obs | Age | Reason | Recommended Action |
|-----|-----|--------|-------------------|
| #3 "src/old-file.ts pattern" | 120 days | File deleted | ARCHIVE |
| #7 "Use moment.js for dates" | 95 days | Dependency removed | ARCHIVE |
```

## Phase 4: Present Curation Plan

Compile all findings into a review table:

```
## Curation Plan

### Actions Required

| # | Observation | Action | Reason |
|---|------------|--------|--------|
| 1 | #12 + #45 | MERGE | Duplicate — keep newer |
| 2 | #5 vs #29 | RESOLVE | Contradicting patterns |
| 3 | #3 | ARCHIVE | Referenced file deleted |
| 4 | #7 | ARCHIVE | Dependency removed |
| 5 | #18 | UPDATE | Low confidence → verify |
```

```typescript
ask_user_question({
  questions: [
    {
      header: "Curate",
      question: "Review the curation plan. Proceed with all actions?",
      options: [
        { label: "Execute all (Recommended)", description: "Apply all actions above" },
        { label: "Let me cherry-pick", description: "I'll approve individually" },
        { label: "Skip curation", description: "No changes to memory" },
      ],
      multiSelect: false,
    },
  ],
});
```

## Phase 5: Execute Curation

For each approved action:

### MERGE (duplicates)

```typescript
// Read both observations
const older = memory-get({ ids: "<older-id>" });
const newer = memory-get({ ids: "<newer-id>" });

// Union-merge: combine comma-separated lists, deduplicate (case-insensitive), existing items first
// Example: older.facts="auth, jwt" + newer.facts="jwt, session" → "auth, jwt, session"

// Create merged observation (newer as base, merge fields from older)
observation({
  type: newer.type,
  title: newer.title,
  narrative: newer.narrative,
  // Manually combine comma-separated fields: keep all unique items from both
  facts: "[combined unique facts from older + newer]",
  concepts: "[combined unique concepts from older + newer]",
  files_modified: "[combined unique file paths from older + newer]",
  confidence: newer.confidence, // Newer confidence wins
  supersedes: "<older-id>",
  subtitle: "Merged from #<older-id> + #<newer-id>",
});
```

**Union merge rule:** Combine comma-separated lists, deduplicate (case-insensitive), existing items first.

### RESOLVE (contradictions)

Present the conflicting observations side-by-side:

```
### Contradiction: #5 vs #29

**#5 (older, high confidence):**
> Always use X pattern for Y components

**#29 (newer, medium confidence):**
> Avoid X pattern — causes Z issues

Which is the current truth?
```

```typescript
ask_user_question({
  questions: [
    {
      header: "Resolve",
      question: "Which observation reflects the current codebase reality?",
      options: [
        { label: "#5 (older) is correct", description: "Archive #29, keep #5" },
        { label: "#29 (newer) is correct", description: "Supersede #5 with #29" },
        { label: "Both partially correct", description: "I'll write a reconciled version" },
      ],
      multiSelect: false,
    },
  ],
});
```

### ARCHIVE (stale)

```typescript
// Verify staleness by checking codebase
// If file doesn't exist or pattern not found:
observation({
  type: "warning",
  title: "Archived: [original title]",
  narrative: "Archived during curation — [reason]. Original observation #<id>.",
  supersedes: "<stale-id>",
  confidence: "low",
});
```

### UPDATE (low confidence → verify)

```typescript
// Search codebase for evidence
// If evidence found → upgrade confidence
// If evidence not found → archive
```

## Phase 6: Compile Knowledge Index

After curation, regenerate the knowledge index:

```typescript
memory-admin({ operation: "compile" });
memory-admin({ operation: "index" });
```

## Phase 7: Report

```
## Curation Summary

**Scope:** [recent / all]
**Observations reviewed:** [N]
**Domains identified:** [N]

| Action | Count | Details |
|--------|-------|---------|
| Merged | [N] | [list merged pairs] |
| Resolved | [N] | [list resolved conflicts] |
| Archived | [N] | [list archived observations] |
| Updated | [N] | [list confidence changes] |
| No change | [N] | |

**Memory health:** [Healthy / Needs attention: describe]
**Next recommended:** /pr or continue work
```

## When Nothing to Curate

If all observations are clean, well-organized, and non-conflicting:

> "Memory is clean. No duplicates, contradictions, or stale observations found. [N] observations across [M] domains."

Don't force curation. Quality memory means less curation needed.

## Related Commands

| Need                    | Command                        |
| ----------------------- | ------------------------------ |
| Extract learnings first | `/compound`                               |
| Full chain              | `/lfg`                                    |
| Check memory status     | Use `memory-admin({ operation: "status" })` |
| Search memory           | Use `memory-search()` directly            |
