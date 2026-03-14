---
description: Create a bead with specification from a description
---

# Create: $@

Create a bead and its specification (PRD) from a description.

> **Workflow:** **`/create`** → `/start <id>` → `/ship <id>`
>
> ⛔ This command creates the specification ONLY. Do NOT write any implementation code.

## Parse Arguments

| Argument        | Default       | Description                        |
| --------------- | ------------- | ---------------------------------- |
| `<description>` | required      | What to build/fix (quoted string)  |
| `--type`        | auto-detected | Override: epic, feature, task, bug |

## Determine Input Type

| Input Type  | Detection            | Action                        |
| ----------- | -------------------- | ----------------------------- |
| Quoted text | `"description here"` | Create PRD from description   |
| Short form  | Simple string        | Ask for more detail if needed |
| `--type`    | Flag provided        | Use provided type             |

## Before You Create

- **Be certain**: Only create beads you're confident have clear scope
- **Don't over-spec**: If the description is vague, ask clarifying questions first
- **Check duplicates**: Always run Phase 1 duplicate check
- **No implementation**: This command creates specs only, don't write code
- **Verify PRD**: Before saving, verify all sections are filled (no placeholders)

## Available Tools

| Tool   | Use When                                     |
| ------ | -------------------------------------------- |
| `bash` | Running br commands, creating files          |
| `grep` | Finding patterns in codebase, affected files |

## Phase 1: Duplicate Check

```bash
br list --status=open --status=in_progress
```

If a matching bead exists, stop and tell the user to use `/start <id>` instead.

## Phase 2: Classify Type

If `--type` was provided, use it directly. Otherwise, suggest a type based on the description and ask the user to confirm:

- **epic**: Multi-session, cross-domain (redesign, migrate, overhaul)
- **feature**: New capability, scoped (add, implement, build, integrate)
- **bug**: Something broken (fix, error, crash, not working)
- **task**: Tactical change, clear scope (everything else)

## Phase 3: Choose Research Depth

Choose the appropriate research depth based on complexity:

- **Deep** (complex/unfamiliar work): Explore patterns, tests, deps, and best practices thoroughly
- **Standard** (typical work): Explore patterns and tests
- **Minimal** (small/clear change): Quick file scan
- **Skip** (well-known codebase): Use existing knowledge

If the work is non-trivial, err toward Standard or Deep. For bugs, always gather reproduction context.

## Phase 4: Gather Context

Based on research depth, explore the codebase:

**If Deep:** Investigate patterns, tests, deps, and (for feature/epic) external best practices. For epics, also review for correctness concerns.

**If Standard:** Investigate patterns and tests. Check external references for feature/epic work.

**If Minimal:** Quick scan for relevant patterns.

**If Skip:** Use existing AGENTS.md context only.

**While researching**, ask clarifying questions if the description lacks scope or expected outcome. For bugs, also ask for reproduction steps and expected vs actual behavior.

## Phase 5: Create Bead

```bash
BEAD_ID=$(br create "$DESCRIPTION" --type $BEAD_TYPE --json | jq -r '.id')
mkdir -p ".beads/artifacts/$BEAD_ID"
```

## Phase 6: Write PRD

Copy and fill the PRD template using context from Phase 4:

```bash
cp .pi/templates/prd.md ".beads/artifacts/$BEAD_ID/prd.md"
```

### Required Sections

| Section           | Source                                                     | Required          |
| ----------------- | ---------------------------------------------------------- | ----------------- |
| Problem Statement | User description + clarifying questions                    | Always            |
| Scope (In/Out)    | User input + codebase exploration                          | Always            |
| Proposed Solution | Codebase patterns + user intent                            | Always            |
| Success Criteria  | User verification + test commands (must include `Verify:`) | Always            |
| Technical Context | Exploration findings                                       | Always            |
| Affected Files    | Exploration findings (real paths from Phase 4)             | Always            |
| Tasks             | Derived from scope + solution                              | Always            |
| Risks             | Codebase exploration                                       | Feature/epic only |
| Open Questions    | Unresolved items from Phase 4                              | If any exist      |

### Task Format

Tasks must follow this format:

- Title with `[category]` tag
- One-sentence **end state** description (not step-by-step)
- Metadata block: `depends_on`, `parallel`, `conflicts_with`, `files`
- At least one verification command per task

## Phase 7: Validate PRD

Before saving, verify:

- [ ] No placeholder text remains (e.g., "[Clear description", "[List what's allowed]")
- [ ] Success criteria include `Verify:` commands
- [ ] Technical context references actual `src/` paths from exploration
- [ ] Affected files list real paths
- [ ] Tasks have `[category]` headings
- [ ] Each task has verification
- [ ] No implementation code in the PRD

If any check fails, fix it — don't ask the user.

## Phase 8: Report

Output:

1. Bead ID and type
2. PRD location (`.beads/artifacts/$BEAD_ID/prd.md`)
3. Summary: task count, success criteria count, affected files count
4. Next steps: `/start $BEAD_ID` or `/plan $BEAD_ID`

```bash
br comments add $BEAD_ID "Created prd.md with [N] tasks, [M] success criteria"
```

---

## Related Commands

| Need            | Command       |
| --------------- | ------------- |
| Research first  | `/research`   |
| Plan after spec | `/plan <id>`  |
| Start working   | `/start <id>` |
