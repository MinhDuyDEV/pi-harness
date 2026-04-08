---
description: Organize, deduplicate, and curate knowledge in project memory
argument-hint: "[--scope recent|all] [--auto-merge]"
---

# Curate: $ARGUMENTS

Organize accumulated knowledge. Surface conflicts, merge duplicates, archive stale observations.

> **Workflow:** `/ship` → `/compound` → **`/curate`** → `/pr`
>
> Run periodically (weekly or after major work) to keep memory sharp.

## Parse Arguments

| Argument       | Default  | Description                                      |
| -------------- | -------- | ------------------------------------------------ |
| `--scope`      | `recent` | `recent` = last 30 days, `all` = entire memory   |
| `--auto-merge` | false    | Auto-merge exact duplicates without confirmation |

## Phase 1: Inventory

```
memory-admin(operation: "status")
memory-admin(operation: "capture-stats")
```

Report total observations, by type, by confidence, and by age.

## Phase 2: Domain Detection

Analyze observations to extract semantic domains — groups of related knowledge.
Search by concept categories (build, test, memory, git, agent, auth, ui, config) and group results.

Maximum 10 domains, snake_case names, semantically meaningful.

## Phase 3: Conflict & Duplicate Detection

### Exact Duplicates

Flag observations with identical or near-identical titles and narratives. Present for merge.

### Contradictions

Search for observations where same concepts have different decisions, same file paths have conflicting patterns, or confidence downgraded without supersedes link.

### Stale Observations

Flag observations where referenced files no longer exist, referenced patterns no longer appear in codebase, or over 90 days old with no related recent activity.

## Phase 4: Present Curation Plan

Compile all findings into a review table with recommended actions (MERGE, RESOLVE, ARCHIVE, UPDATE).
Ask user to approve before executing.

## Phase 5: Execute Curation

### MERGE (duplicates)
- Read both observations
- Union-merge: combine comma-separated lists, deduplicate (case-insensitive)
- Create merged observation (newer as base), superseding the older

### RESOLVE (contradictions)
- Present conflicting observations side-by-side
- Ask user which is current truth

### ARCHIVE (stale)
- Verify staleness by checking codebase
- Create superseding observation marked as archived

### UPDATE (low confidence)
- Search codebase for evidence
- If found → upgrade confidence
- If not found → archive

## Phase 6: Report

```
## Curation Summary

**Scope:** [recent / all]
**Observations reviewed:** [N]
**Domains identified:** [N]

| Action   | Count | Details                  |
|----------|-------|--------------------------|
| Merged   | [N]   | [list merged pairs]      |
| Resolved | [N]   | [list resolved conflicts]|
| Archived | [N]   | [list archived]          |
| Updated  | [N]   | [list confidence changes]|

**Memory health:** [Healthy / Needs attention]
**Next recommended:** /pr or continue work
```

## When Nothing to Curate

> "Memory is clean. No duplicates, contradictions, or stale observations found."

Don't force curation. Quality memory means less curation needed.

## Related Commands

| Need                    | Command                        |
| ----------------------- | ------------------------------ |
| Extract learnings first | `/compound`                    |
| Full chain              | `/lfg`                         |
| Search memory           | Use `memory-search` directly   |
