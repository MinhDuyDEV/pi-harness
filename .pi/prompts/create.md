---
description: Create a bead with specification, claim it, and prepare workspace
argument-hint: "<description> [--type epic|feature|task|bug] [--spec-only]"
---

# Create: $ARGUMENTS

Create a bead, write its specification (PRD), claim it, set up the workspace, and convert to executable tasks — ready for `/ship`.

> **Workflow:** **`/create`** → `/ship <id>`
>
> Use `--spec-only` to create the specification without claiming or setting up workspace.

## Parse Arguments

| Argument        | Default       | Description                               |
| --------------- | ------------- | ----------------------------------------- |
| `<description>` | required      | What to build/fix (quoted string)         |
| `--type`        | auto-detected | Override: epic, feature, task, bug        |
| `--spec-only`   | false         | Create spec without claiming or workspace |

## Before You Create

- **Be certain**: Only create beads you're confident have clear scope
- **Don't over-spec**: If the description is vague, ask clarifying questions first
- **Check duplicates**: Always run Phase 1 duplicate check
- **No implementation**: This command creates specs and workspace — don't write implementation code
- **Verify PRD**: Before saving, verify all sections are filled (no placeholders)
- **Flag uncertainty**: Use `[NEEDS CLARIFICATION]` markers for unknowns — never guess silently

## Phase 1: Duplicate Check

Search memory for prior work on this topic, then check open beads:

```bash
br list --status=open --status=in_progress
```

If a matching bead exists, stop and tell the user to use `/ship <id>` instead.

## Phase 2: Classify Type

If `--type` was provided, use it directly. Otherwise, suggest a type:

- **epic**: Multi-session, cross-domain (redesign, migrate, overhaul)
- **feature**: New capability, scoped (add, implement, build, integrate)
- **bug**: Something broken (fix, error, crash, not working)
- **task**: Tactical change, clear scope (everything else)

## Phase 3: Choose Research Depth

Ask user before spawning agents:

| Depth    | Agents                                             | Time     |
| -------- | -------------------------------------------------- | -------- |
| Deep     | 3-5 agents: patterns, tests, deps, best practices | ~2 min   |
| Standard | 2 agents: patterns + tests                        | ~1 min   |
| Minimal  | 1 agent: quick file scan                          | ~30 sec  |
| Skip     | No agents, use existing knowledge                 | Instant  |

## Phase 4: Gather Context

Based on research depth choice, spawn agents:

**Deep:** 3x `explore` (patterns, tests, deps) + 1x `scout` (feature/epic) + 1x `reviewer` (epic)
**Standard:** 2x `explore` (patterns, tests) + 1x `scout` (feature/epic only)
**Minimal:** 1x `explore` (patterns)
**Skip:** No agents

**While agents run**, ask clarifying questions if scope or expected outcome is unclear.

## Phase 5: Create Bead

Extract title and description from `$ARGUMENTS`:
- Single line → use for both title and description
- Multiple lines → first line as title, full text as description

```bash
BEAD_ID=$(br create --title "$TITLE" --description "$DESCRIPTION" --type $BEAD_TYPE --json | jq -r '.id')
mkdir -p ".beads/artifacts/$BEAD_ID"
```

## Phase 6: Determine PRD Rigor

Not every change needs a full spec. Assess complexity:

| Signal         | Lite PRD                  | Full PRD                        |
| -------------- | ------------------------- | ------------------------------- |
| Type           | `bug`, `task`             | `feature`, `epic`               |
| Files affected | 1-3                       | 4+                              |
| Scope          | Clear, single-concern     | Cross-cutting, multi-system     |
| Research depth | Skip or Minimal           | Standard or Deep                |

**Auto-detect:** If type is `bug`/`task` AND research was Skip/Minimal AND simple description → Lite.

### Lite PRD Format

```markdown
# [Title]

## Problem
[1-2 sentences]

## Solution
[1-2 sentences]

## Affected Files
- `src/path/to/file.ts`

## Tasks
- [ ] [Task description] → Verify: `[command]`

## Success Criteria
- Verify: `npm run typecheck && npm run lint`
```

### Full PRD Format

Use the full PRD template with all sections:
Problem Statement, Scope, Proposed Solution, Success Criteria, Technical Context, Affected Files, Tasks, Risks, Open Questions.

## Phase 7: Write PRD

Fill the chosen format using context from Phase 4.

| Section           | Source                                   | Required          |
| ----------------- | ---------------------------------------- | ----------------- |
| Problem Statement | User description + clarifying questions  | Always            |
| Scope (In/Out)    | User input + codebase exploration        | Always            |
| Proposed Solution | Codebase patterns + user intent          | Always            |
| Success Criteria  | Must include `Verify:` commands          | Always            |
| Affected Files    | Real paths from exploration              | Always            |
| Tasks             | Derived from scope + solution            | Always            |
| Risks             | Codebase exploration                     | Feature/epic only |

### Task Format

- Title with `[category]` tag
- One-sentence **end state** description (not step-by-step)
- Metadata: `depends_on`, `parallel`, `conflicts_with`, `files`
- At least one verification command per task

## Phase 8: Validate PRD

Before saving:

- [ ] No placeholder text remains
- [ ] Success criteria include `Verify:` commands
- [ ] Technical context references actual paths from exploration
- [ ] Affected files list real paths
- [ ] Tasks have `[category]` headings and verification
- [ ] No implementation code in the PRD
- [ ] No unresolved `[NEEDS CLARIFICATION]` markers remain

If any check fails, fix it — don't ask the user.

## Phase 9: Claim and Prepare Workspace

**If `--spec-only` was passed, skip to Phase 10 (Report).**

```bash
git status --porcelain
git branch --show-current
br list --status=in_progress
```

- If uncommitted changes: ask user to stash, commit, or continue
- If other tasks in progress: warn before claiming another

```bash
br update $BEAD_ID --status in_progress
```

Create branch and optionally offer worktree setup.

## Phase 10: Report

Output:

1. Bead ID and type
2. PRD location (`.beads/artifacts/$BEAD_ID/prd.md`)
3. Summary: task count, success criteria count, affected files count
4. Branch name and workspace (if claimed)
5. Next step: `/ship $BEAD_ID` (or `/plan $BEAD_ID` for complex work)

```bash
br comments add $BEAD_ID "Created prd.md with [N] tasks, [M] success criteria"
```

## Related Commands

| Need               | Command      |
| ------------------ | ------------ |
| Research first     | `/research`  |
| Plan after spec    | `/plan <id>` |
| Implement and ship | `/ship <id>` |
