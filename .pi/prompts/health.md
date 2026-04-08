---
description: Audit .pi/ configuration for consistency, stale references, and enforcement gaps
argument-hint: "[--fix] [--layer <intent|knowledge|control>]"
---

# Health Check: $ARGUMENTS

Self-audit the `.pi/` configuration for drift, inconsistencies, and enforcement gaps.

## Parse Arguments

| Argument  | Default | Description                                         |
| --------- | ------- | --------------------------------------------------- |
| `--fix`   | false   | Auto-fix safe issues (stale refs, dead links)       |
| `--layer` | all     | Focus on specific layer: intent, knowledge, control |

## Overview

Multi-layer health check based on three-layer defense:

1. **Intent** (SYSTEM.md / AGENTS.md) — policies and rules
2. **Knowledge** (Skills) — procedures and workflows
3. **Control** (Agent frontmatter, hooks) — structural enforcement

A rule that exists at intent but not control is a gap.

## Phase 1: Inventory

Build an inventory of all `.pi/` artifacts:

```bash
echo "=== Agents ===" && ls .pi/agents/ | wc -l
echo "=== Prompts ===" && ls .pi/prompts/ | wc -l
echo "=== Extensions ===" && ls .pi/extensions/*.ts 2>/dev/null | wc -l
echo "=== Templates ===" && ls .pi/templates/ | wc -l
```

## Phase 2: Stale Reference Detection

### Agent references in prompts
- Check if prompts reference agent types that don't exist in `.pi/agents/`

### Skill references
- For every skill reference in prompts, verify the skill exists globally or in project

### Cross-references between skills
- Verify dependency skills exist

Report format:

```
| Reference Type | Source File         | Target    | Status  |
|---------------|---------------------|-----------|---------|
| agent         | prompts/ship.md     | worker    | OK      |
| skill         | prompts/plan.md     | old-skill | MISSING |
```

## Phase 3: Three-Layer Defense Audit

Check top safety rules for three-layer coverage:

| Rule                        | Intent (SYSTEM.md) | Knowledge (Skill) | Control (Agent/Hook) |
| --------------------------- | ------------------ | ----------------- | -------------------- |
| Never force push main       | ?                  | ?                 | ?                    |
| Never bypass hooks          | ?                  | ?                 | ?                    |
| Never expose credentials    | ?                  | ?                 | ?                    |
| Verify before completion    | ?                  | ?                 | ?                    |
| Never `git add .`           | ?                  | ?                 | ?                    |
| Review agents are read-only | ?                  | ?                 | ?                    |

Flag rules with intent but no control as **IMPORTANT** gaps.

## Phase 4: AI Governance Audit

### Token Budget Estimation

Estimate total token cost of context injected into each prompt execution.

**Thresholds:**
- **OK**: < 15k tokens
- **HEAVY**: 15-30k tokens
- **BLOATED**: > 30k tokens

### Instruction Bloat Detection

| File             | Lines | Threshold                  |
| ---------------- | ----- | -------------------------- |
| Skills           | [N]   | WARN > 200, BLOATED > 400 |
| Prompts          | [N]   | WARN > 300, BLOATED > 500 |
| SYSTEM.md        | [N]   | WARN > 500, BLOATED > 800 |

### Rule Echo Detection

Find instructions duplicated across layers (SYSTEM.md, agent prompts, skills). Flag redundant duplicates.

## Phase 5: Report

```markdown
## Health Report

**Date:** [timestamp]
**Configuration:** [X agents, Y prompts, Z extensions]

| Layer   | Issues Found | Critical | Important | Minor |
| ------- | ------------ | -------- | --------- | ----- |
| Refs    | N            | N        | N         | N     |
| Defense | N            | N        | N         | N     |
| Agents  | N            | N        | N         | N     |
| TOTAL   | N            | N        | N         | N     |

### Critical Issues
- [list]

### Important Issues
- [list]

### Recommendations
- [prioritized list of fixes]
```

If `--fix` flag, auto-fix safe issues after confirmation.

## Related Commands

| Need                | Command            |
| ------------------- | ------------------ |
| Review code         | `/review-codebase` |
| Check project state | `/status`          |
| Curate memory       | `/curate`          |
