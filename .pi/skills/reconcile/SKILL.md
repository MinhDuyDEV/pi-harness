---
name: reconcile
description: >
  Use when verifying implementation matches its specification — detects drift between PRD requirements
  and actual code, identifies missing features, extra features, and diverged behavior. Load after /ship
  or before closing a bead.
version: 1.0.0
tags: [workflow, verification, quality]
dependencies: [verification-before-completion]
---

# Reconcile — Spec↔Code Drift Detection

## When to Use

- After `/ship` completes all tasks, before closing the bead
- When you suspect implementation has drifted from the original spec
- During `/review-codebase` to check spec adherence
- Before creating a PR to verify completeness

## When NOT to Use

- During active implementation (wait until tasks are done)
- For code quality issues (use `requesting-code-review` instead)
- For structural config audits (use `/health` instead)

## Overview

Implementation drift is the silent killer of spec-driven development. Tasks can pass all verification gates while the overall feature drifts from its specification. This skill systematically compares PRD artifacts against code evidence.

## Reconciliation Process

### Step 1: Load Artifacts

```bash
# Read the PRD
cat .beads/artifacts/$BEAD_ID/prd.md

# Read the plan (if exists)
cat .beads/artifacts/$BEAD_ID/plan.md 2>/dev/null

# Determine comparison base (works with main, master, or any default branch)
BASE=$(git rev-parse origin/main 2>/dev/null || git rev-parse origin/master 2>/dev/null || git merge-base HEAD $(git rev-parse --abbrev-ref HEAD@{upstream} 2>/dev/null || echo HEAD~10))

# Get the actual diff
git diff $BASE --name-only
git diff $BASE --stat
```

### Step 2: Extract Spec Claims

From the PRD, extract these verifiable claims:

| Claim Type                  | Source Section                          | Example                             |
| --------------------------- | --------------------------------------- | ----------------------------------- |
| **Success Criteria**        | `## Success Criteria`                   | "User can see existing messages"    |
| **Functional Requirements** | `## Requirements`                       | "WHEN user clicks X THEN Y happens" |
| **Affected Files**          | `## Technical Context > Affected Files` | `src/api/users.ts`                  |
| **Scope Boundaries**        | `## Scope`                              | "In-scope: X, Out-of-scope: Y"      |
| **Task Deliverables**       | `## Tasks`                              | Each task's end-state description   |

### Step 3: Verify Each Claim

For each extracted claim, gather evidence:

#### Success Criteria Verification

```bash
# For each success criterion, find code evidence
# Example: "User can see existing messages"
grep -r "messages" src/ --include="*.ts" --include="*.tsx" -l
grep -r "fetchMessages\|getMessages\|listMessages" src/ -l
```

Map each criterion to:

- **VERIFIED**: Code evidence confirms the criterion is met
- **PARTIAL**: Some evidence exists but incomplete
- **MISSING**: No code evidence found
- **UNTESTABLE**: Cannot be verified via code search (needs manual check)

#### Affected Files Verification

```bash
# Compare PRD affected files vs actual changed files
# PRD claims these files would be modified:
PRD_FILES=$(grep -A 50 "Affected Files" .beads/artifacts/$BEAD_ID/prd.md | grep "src/" | sed 's/.*`//' | sed 's/`.*//')

# Actually modified files:
ACTUAL_FILES=$(git diff $BASE --name-only)

# Files in PRD but not modified (missing implementation):
comm -23 <(echo "$PRD_FILES" | sort) <(echo "$ACTUAL_FILES" | sort)

# Files modified but not in PRD (scope creep):
comm -13 <(echo "$PRD_FILES" | sort) <(echo "$ACTUAL_FILES" | sort)
```

#### Scope Boundary Check

- **In-scope items**: Verify each has corresponding code changes
- **Out-of-scope items**: Verify NO code touches those areas (scope creep detection)

### Step 4: Detect Drift Patterns

| Drift Type                 | Detection Method                                       | Severity |
| -------------------------- | ------------------------------------------------------ | -------- |
| **Missing Feature**        | Success criterion with no code evidence                | HIGH     |
| **Partial Implementation** | Criterion partially met (stub, TODO)                   | HIGH     |
| **Scope Creep**            | Files modified that aren't in PRD affected files       | MEDIUM   |
| **Spec Rot**               | PRD sections that contradict actual implementation     | MEDIUM   |
| **Over-Engineering**       | Significant code not traceable to any PRD requirement  | LOW      |
| **Diverged Behavior**      | Code does something different from WHEN/THEN scenarios | HIGH     |

### Step 5: Calculate Drift Score

```
Drift Score Calculation:
- Total claims: [N]
- VERIFIED: [n] (×1.0)
- PARTIAL: [n] (×0.5)
- MISSING: [n] (×0.0)
- UNTESTABLE: [n] (excluded from calculation)

Adherence = (VERIFIED×1.0 + PARTIAL×0.5) / (Total - UNTESTABLE) × 100

Scope Creep = Extra files modified / Total files modified × 100
```

## Drift Report Format

```markdown
## Reconciliation Report: <bead-id>

**PRD:** `.beads/artifacts/<id>/prd.md`
**Branch:** `<branch-name>`
**Adherence Score:** [N]%
**Scope Creep:** [N]%

### Success Criteria

| #   | Criterion        | Status      | Evidence                                   |
| --- | ---------------- | ----------- | ------------------------------------------ |
| 1   | [criterion text] | ✅ VERIFIED | `src/file.ts:42` — [what confirms it]      |
| 2   | [criterion text] | ⚠️ PARTIAL  | `src/file.ts` exists but handler is a stub |
| 3   | [criterion text] | ❌ MISSING  | No code evidence found                     |

### File Reconciliation

| Category                    | Files                      | Count |
| --------------------------- | -------------------------- | ----- |
| ✅ Expected & Modified      | `src/api/users.ts`, ...    | [N]   |
| ❌ Expected but Untouched   | `src/models/user.ts`, ...  | [N]   |
| ⚠️ Unexpected Modifications | `src/utils/helper.ts`, ... | [N]   |

### Drift Issues

| #   | Type            | Severity | Description      | Recommendation                                                 |
| --- | --------------- | -------- | ---------------- | -------------------------------------------------------------- |
| 1   | Missing Feature | HIGH     | [what's missing] | Implement or use `/iterate --scope reduce` to remove from spec |
| 2   | Scope Creep     | MEDIUM   | [what's extra]   | Document in PRD or revert                                      |

### Verdict

| Score       | Meaning              | Action                                                 |
| ----------- | -------------------- | ------------------------------------------------------ |
| **90-100%** | Excellent adherence  | Ready to close                                         |
| **70-89%**  | Good with minor gaps | Fix gaps or document as intentional deviations         |
| **50-69%**  | Significant drift    | Use `/iterate` to reconcile spec and code              |
| **<50%**    | Major drift          | **BLOCK** — spec and code are fundamentally misaligned |
```

## Integration Points

- **`/ship` Phase 5**: Run reconcile after review, before close decision
- **`/compound`**: Include adherence score in retrospective observations
- **`/pr`**: Include drift report in PR description

## Gotchas

- Some criteria genuinely can't be verified by code search (UI behavior, UX feel) — mark as UNTESTABLE, don't count against score
- Scope creep isn't always bad — sometimes good engineering requires touching adjacent files. Flag it, don't auto-block.
- Run AFTER phantom completion detection — reconcile assumes code is substantive, not stubs
