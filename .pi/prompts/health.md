---
description: Audit .pi/ configuration for consistency, stale references, and enforcement gaps
argument-hint: "[--fix] [--layer <intent|knowledge|control>]"
agentType: reviewer
---

# Health Check: $ARGUMENTS

Self-audit the .pi/ configuration for drift, inconsistencies, and enforcement gaps.

## Load Skills

```typescript
skill({ name: "verification-before-completion" });
```

## Parse Arguments

| Argument  | Default | Description                                         |
| --------- | ------- | --------------------------------------------------- |
| `--fix`   | false   | Auto-fix safe issues (stale refs, dead links)       |
| `--layer` | all     | Focus on specific layer: intent, knowledge, control |

## Overview

This command runs a multi-layer health check inspired by three-layer defense:

1. **Intent** (AGENTS.md) — policies and rules
2. **Knowledge** (Skills) — procedures and workflows
3. **Control** (Agent frontmatter, hooks) — structural enforcement

A rule that exists at intent but not control is a gap. This command finds those gaps.

## Phase 1: Inventory

Build an inventory of all .pi/ artifacts:

```bash
# Count artifacts
echo "=== Skills ==="
ls .pi/skill/ | wc -l
echo "=== Commands ==="
ls .pi/command/ | wc -l
echo "=== Agents ==="
ls .pi/agent/ | wc -l
echo "=== Tools ==="
ls .pi/tool/ 2>/dev/null | wc -l
echo "=== Plugins ==="
ls .pi/plugin/ 2>/dev/null | wc -l
```

Report totals as a summary table.

## Phase 2: Stale Reference Detection

Check for references to skills, commands, or agents that don't exist:

### 2a. Skill references in commands and AGENTS.md

For every `skill({ name: "X" })` call found in `.pi/command/*.md` and `AGENTS.md`:

- Verify `.pi/skill/X/SKILL.md` exists
- Flag any that don't exist as **CRITICAL**

### 2b. Command references in skills and AGENTS.md

For every `/command-name` reference found in `.pi/skill/*/SKILL.md` and `AGENTS.md`:

- Verify `.pi/command/command-name.md` exists
- Flag missing as **IMPORTANT**

### 2c. Agent references

For every `agent: X` in command frontmatter:

- Verify `.pi/agent/X.md` exists (or is a built-in agent)
- Flag missing as **CRITICAL**

### 2d. Cross-references between skills

For every `dependencies: [X, Y]` in skill YAML frontmatter:

- Verify each dependency skill exists
- Flag missing as **IMPORTANT**

Report format:

```text
| Reference Type       | Source File           | Target        | Status  |
|---------------------|-----------------------|---------------|---------|
| skill()             | command/ship.md:15    | beads         | OK      |
| skill()             | command/plan.md:22    | old-skill     | MISSING |
| /command             | skill/X/SKILL.md:45   | /deploy       | MISSING |
```

## Phase 3: Skill Quality Audit

For each skill in `.pi/skill/*/SKILL.md`:

1. **Frontmatter check:**
   - [ ] Has `name:` field
   - [ ] Has `description:` field
   - [ ] `name:` matches directory name
   - [ ] Starts with `---` on line 1

2. **Content check:**
   - [ ] Has `## When to Use` section
   - [ ] Has `## When NOT to Use` section
   - [ ] Under 200 lines (warn if over)
   - [ ] Has `## Gotchas` section (advisory — new skills may not have one yet)

3. **Description trigger check:**
   - [ ] Description starts with action trigger (Use when, MUST load, Use INSTEAD OF)
   - Flag descriptions that don't specify when to load as **MINOR**

Report as a scorecard:

```text
| Skill                   | Frontmatter | Content | Trigger | Gotchas | Lines | Grade |
|-------------------------|-------------|---------|---------|---------|-------|-------|
| verification-before-... | OK          | OK      | OK      | NO      | 237   | B+    |
| skill-creator           | OK          | OK      | OK      | NO      | 157   | B     |
```

Grade scale:

- **A** — all checks pass including gotchas
- **B+** — all required checks pass, missing gotchas (acceptable for newer skills)
- **B** — missing one optional section
- **C** — missing required section or over 200 lines
- **D** — frontmatter issues
- **F** — broken (missing name, missing description, invalid YAML)

## Phase 4: Three-Layer Defense Audit

Check the top safety rules from AGENTS.md for three-layer coverage:

| Rule                           | Intent (AGENTS.md) | Knowledge (Skill) | Control (Agent/Hook) |
| ------------------------------ | ------------------ | ----------------- | -------------------- |
| Never force push main          | ?                  | ?                 | ?                    |
| Never bypass hooks             | ?                  | ?                 | ?                    |
| Never expose credentials       | ?                  | ?                 | ?                    |
| Read before write/edit         | ?                  | ?                 | ?                    |
| Verify before completion       | ?                  | ?                 | ?                    |
| Never `git add .`              | ?                  | ?                 | ?                    |
| Review agents are read-only    | ?                  | ?                 | ?                    |
| Never fabricate tool output    | ?                  | ?                 | ?                    |
| Ask before destructive actions | ?                  | ?                 | ?                    |

For each rule:

- **Intent**: grep AGENTS.md for the policy statement
- **Knowledge**: check if any skill documents the procedure
- **Control**: check if any agent frontmatter enforces it (tools: false, permission: deny)

Flag rules with intent but no control as **IMPORTANT** gaps.

## Phase 5: AI Governance Audit

Audit AI-facing configuration for token efficiency, rule health, and instruction quality.

### 5a. Token Budget Estimation

Estimate the total token cost of context injected into each command execution:

```bash
# Base context (always injected)
echo "=== Base Context ==="
wc -c AGENTS.md
wc -c .pi/memory/project/user.md .pi/memory/project/tech-stack.md .pi/memory/project/project.md 2>/dev/null
echo "=== Agent Prompts ==="
wc -c .pi/agent/*.md 2>/dev/null
```

For each command, estimate total context = Base + Agent prompt + Skills loaded:

| Command | Base | Agent    | Skills Loaded                                          | Est. Tokens | Budget             |
| ------- | ---- | -------- | ------------------------------------------------------ | ----------- | ------------------ |
| `/ship` | [N]  | build.md | beads, memory-grounding, workspace-setup, verification | [total]     | [OK/HEAVY/BLOATED] |
| `/plan` | [N]  | plan.md  | beads, memory-grounding, writing-plans                 | [total]     | [OK/HEAVY/BLOATED] |
| ...     | ...  | ...      | ...                                                    | ...         | ...                |

**Thresholds:**

- **OK**: < 15k tokens total injected context
- **HEAVY**: 15-30k tokens (warn — leaves less room for codebase context)
- **BLOATED**: > 30k tokens (flag — likely causing quality degradation)

Rough token estimate: `bytes / 4` for English text.

### 5b. Rule Echo Detection

Find instructions duplicated across layers:

```bash
# Find common instruction phrases across AGENTS.md and agent prompts
# Look for exact or near-duplicate paragraphs
grep -hF "Never" AGENTS.md .pi/agent/*.md | sort | uniq -c | sort -rn | head -20
grep -hF "Always" AGENTS.md .pi/agent/*.md | sort | uniq -c | sort -rn | head -20
grep -hF "MUST" AGENTS.md .pi/agent/*.md | sort | uniq -c | sort -rn | head -20
```

Also check for:

- Rules in AGENTS.md that are repeated verbatim in agent prompts (redundant — AGENTS.md is already injected)
- Rules in agent prompts that contradict AGENTS.md (dangerous)
- Rules in skills that duplicate AGENTS.md content (bloat)

Report:

| Rule Text (truncated)   | Found In            | Count | Issue                       |
| ----------------------- | ------------------- | ----- | --------------------------- |
| "Never force push main" | AGENTS.md, build.md | 2     | ECHO — remove from build.md |
| "Stage specific files"  | AGENTS.md, ship.md  | 2     | ECHO — remove from ship.md  |

### 5c. Instruction Bloat Detection

Flag oversized configuration files:

| File             | Lines | Tokens (est.) | Status            |
| ---------------- | ----- | ------------- | ----------------- |
| AGENTS.md        | [N]   | [N]           | [OK/WARN/BLOATED] |
| [skill]/SKILL.md | [N]   | [N]           | [OK/WARN/BLOATED] |
| [command].md     | [N]   | [N]           | [OK/WARN/BLOATED] |

**Thresholds:**

- Skills: WARN > 200 lines, BLOATED > 400 lines
- Commands: WARN > 300 lines, BLOATED > 500 lines
- AGENTS.md: WARN > 500 lines, BLOATED > 800 lines

### 5d. Compression Opportunities

Identify repeated boilerplate across skills and commands:

````bash
# Find common blocks across skills
for f in .pi/skill/*/SKILL.md; do
  grep -c "## When to Use" "$f"
  grep -c "## When NOT to Use" "$f"
done

# Find repeated code blocks
grep -rh "```typescript" .pi/command/*.md | wc -l
grep -rh "skill({ name:" .pi/command/*.md | sort | uniq -c | sort -rn | head -10
````

Flag opportunities:

- Skills that share >50% identical content (candidates for merging or shared base)
- Commands with identical boilerplate sections (candidates for shared template)
- Repeated `skill({ name: "X" })` calls across commands (consider making X a dependency)

### AI Governance Report

```text
## AI Governance Summary

Token Budget:
- Lightest command: [command] ([N] tokens)
- Heaviest command: [command] ([N] tokens)
- Commands over budget: [list]

Rule Health:
- Echo rules found: [N] (wasted tokens on duplicates)
- Contradictions found: [N] (CRITICAL)
- Compression opportunities: [N]

Instruction Bloat:
- Oversized skills: [N]
- Oversized commands: [N]
- AGENTS.md status: [OK/WARN/BLOATED]

Recommendations:
1. [Most impactful recommendation]
2. [Second recommendation]
3. [Third recommendation]
```

## Phase 6: Agent Tool Restriction Audit

For each agent in `.pi/agent/*.md`:

1. Read the agent's YAML frontmatter
2. Check `tools:` restrictions (which tools are disabled)
3. Check `permission:` restrictions (which commands are denied/asked)
4. Compare against the agent's stated role

Flag:

- **CRITICAL**: Write-capable agents that should be read-only (review, explore, scout)
- **IMPORTANT**: Agents with no tool restrictions at all
- **MINOR**: Agents with restrictions that could be tighter

## Phase 7: Report

Output a health report:

```markdown
## Health Report

**Date:** [timestamp]
**Configuration:** [X skills, Y commands, Z agents]

### Summary

| Layer   | Issues Found | Critical | Important | Minor |
| ------- | ------------ | -------- | --------- | ----- |
| Refs    | N            | N        | N         | N     |
| Skills  | N            | N        | N         | N     |
| Defense | N            | N        | N         | N     |
| Agents  | N            | N        | N         | N     |
| TOTAL   | N            | N        | N         | N     |

### Critical Issues

- [list]

### Important Issues

- [list]

### Minor Issues

- [list]

### Recommendations

- [prioritized list of fixes]
```

If `--fix` flag is provided, auto-fix `safe_auto` issues:

- Remove stale skill references from commands (after confirmation)
- Add missing `## Gotchas` placeholder sections to skills
- Fix frontmatter formatting issues

Record findings:

```typescript
observation({
  type: "discovery",
  title: "Health check: [summary]",
  narrative: "[Key findings and gaps discovered]",
  concepts: "health, audit, configuration",
  confidence: "high",
});
```

## Related Commands

| Need                | Command            |
| ------------------- | ------------------ |
| Review code         | `/review-codebase` |
| Check project state | `/status`          |
| Verify a bead       | `/verify <id>`     |
