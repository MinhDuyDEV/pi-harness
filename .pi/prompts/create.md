---
description: Create a bead with specification, claim it, and prepare workspace
argument-hint: "<description> [--type epic|feature|task|bug] [--spec-only]"
---

# Create: $ARGUMENTS

Create a bead, write its specification (PRD), claim it, set up the workspace, and convert to executable tasks — ready for `/ship`.

> **Workflow:** **`/create`** → `/ship <id>`
>
> Use `--spec-only` to create the specification without claiming or setting up workspace.
>
> `/create` handles everything: pre-flight validation, spec creation, bead claiming, workspace setup, and task breakdown.

## Load Skills

```typescript
skill({ name: "beads" });
skill({ name: "memory-system" });
skill({ name: "using-git-worktrees" });
skill({ name: "spec-driven-development" }); // PRD/spec guidance
skill({ name: "beads" }); // PRD → executable tasks (Phase 8)
```

## Parse Arguments

| Argument        | Default       | Description                               |
| --------------- | ------------- | ----------------------------------------- |
| `<description>` | required      | What to build/fix (quoted string)         |
| `--type`        | auto-detected | Override: epic, feature, task, bug        |
| `--spec-only`   | false         | Create spec without claiming or workspace |

## Determine Input Type

| Input Type  | Detection            | Action                        |
| ----------- | -------------------- | ----------------------------- |
| Quoted text | `"description here"` | Create PRD from description   |
| Short form  | Simple string        | Ask for more detail if needed |
| `--type`    | Flag provided        | Use provided type             |

## Before You Create

- **Be certain**: Only create beads you're confident have clear scope
- **Don't over-spec**: If the description is vague, ask clarifying questions first
- **Check workspace**: Don't create if uncommitted changes exist in the active branch
- **One task at a time**: Warn if other beads are already in progress
- **No implementation**: This command creates specs and workspace — don't write implementation code
- **Verify PRD**: Before saving, verify all sections are filled (no placeholders)
- **Flag uncertainty**: Use `[NEEDS CLARIFICATION]` markers for unknowns — never guess silently

## Available Tools

| Tool      | Use When                                     |
| --------- | -------------------------------------------- |
| `explore` | Finding patterns in codebase, affected files |
| `scout`   | External research, best practices            |
| `br`      | Creating and managing beads                  |

## Phase 1: Pre-flight Checks

Check workspace state before creating. Don't start if there are uncommitted changes or overlapping work.

```bash
git status --porcelain
git branch --show-current
br list --status=in_progress
```

- If uncommitted changes exist: ask user to stash, commit, or continue.
- If other beads are in progress: warn and confirm before claiming another.
- If current branch is `main` or `master`: recommend creating a feature branch.

**Exit criteria:** Workspace is clean and user is ready to proceed.

## Phase 2: Duplicate Check

### Memory Search

Follow the `memory-system` skill protocol. Focus on duplicate bead detection and prior decisions.

### Bead List Check

```bash
br list --status=open --status=in_progress
```

If a matching bead exists, stop and tell the user to use `/ship <id>` instead.

## Phase 3: Classify Type

If `--type` was provided, use it directly. Otherwise, suggest a type based on the description and ask the user to confirm:

- **epic**: Multi-session, cross-domain (redesign, migrate, overhaul)
- **feature**: New capability, scoped (add, implement, build, integrate)
- **bug**: Something broken (fix, error, crash, not working)
- **task**: Tactical change, clear scope (everything else)

## Phase 4: Choose Research Depth

Ask user before spawning agents:

```typescript
ask_user_question({
  questions: [
    {
      header: "Research Depth",
      question: "How much codebase research do you need?",
      options: [
        {
          label: "Deep (Recommended for complex work)",
          description: "3-5 agents: patterns, tests, deps, best practices (~2 min)",
        },
        {
          label: "Standard",
          description: "2 agents: patterns + tests (~1 min)",
        },
        {
          label: "Minimal",
          description: "1 agent: quick file scan (~30 sec)",
        },
        {
          label: "Skip",
          description: "I know the codebase, use existing knowledge",
        },
      ],
      multiSelect: false,
    },
  ],
});
```

## Phase 5: Gather Context

Based on research depth choice, spawn agents:

**If Deep:**

- 3x `explore` (patterns, tests, deps)
- 1x `scout` (feature/epic)
- 1x `review` (epic)

**If Standard:**

- 2x `explore` (patterns, tests)
- 1x `scout` (feature/epic only)

**If Minimal:**

- 1x `explore` (patterns)

**If Skip:**

- No agents, use existing AGENTS.md context

**While agents run**, ask clarifying questions if the description lacks scope or expected outcome. For bugs, also ask for reproduction steps and expected vs actual behavior.

## Phase 6: Create Bead

Extract bead title and description from `$ARGUMENTS` before creating the bead.

- If user provided a single line, use it for both title and description.
- If user provided multiple lines, use first line as title and full text as description.

```bash
BEAD_ID=$(br create --title "$TITLE" --description "$DESCRIPTION" --type $BEAD_TYPE --json | jq -r '.id')
mkdir -p ".beads/artifacts/$BEAD_ID"
```

## Phase 7: Determine PRD Rigor

Not every change needs a full spec. Assess complexity to choose the right PRD level:

| Signal | Lite PRD | Full PRD |
| --- | --- | --- |
| Type | `bug`, `task` | `feature`, `epic` |
| Files affected | 1-3 | 4+ |
| Scope | Clear, single-concern | Cross-cutting, multi-system |
| Research depth | Skip or Minimal | Standard or Deep |
| Description | "Fix X in Y" | "Implement X with Y and Z" |

**Auto-detect:** If type is `bug` or `task` AND research was Skip/Minimal AND description is a single sentence → default to Lite.

### Lite PRD Format

For simple, well-scoped work (bugs, small tasks):

```markdown
# [Title]

## Problem
[1-2 sentences: what's wrong or what's needed]

## Solution
[1-2 sentences: what to do]

## Affected Files
- `src/auth/login.ts`

## Tasks
- [ ] Add input validation in `src/auth/login.ts` → Verify: `npm run lint && npm run typecheck`

## Success Criteria
- Verify: `npm run lint && npm run typecheck`
- Verify: `npm run test -- login`
```

### Full PRD Format

For features and complex work, use the full template:

Read the PRD template from `.pi/memory/_templates/prd.md` and write it to `.beads/artifacts/$BEAD_ID/prd.md`.

## Phase 8: Write PRD

Copy and fill the PRD template (lite or full) using context from Phase 4.

**If Lite PRD:** Fill the lite format directly. No template file needed.

**If Full PRD:** Read the template and fill all required sections:

| Section           | Source                                                     | Required          |
| ----------------- | ---------------------------------------------------------- | ----------------- |
| Problem Statement | User description + clarifying questions                    | Always            |
| Scope (In/Out)    | User input + codebase exploration                          | Always            |
| Proposed Solution | Codebase patterns + user intent                            | Always            |
| Success Criteria  | User verification + test commands (must include `Verify:`) | Always            |
| Technical Context | Explore agent findings                                     | Always            |
| Affected Files    | Explore agent findings (real paths from Phase 4)           | Always            |
| Tasks             | Derived from scope + solution                              | Always            |
| Risks             | Codebase exploration                                       | Feature/epic only |
| Open Questions    | Unresolved items from Phase 4                              | If any exist      |

### Task Format

Tasks must follow the Beads PRD task format:

- Title with `[category]` tag
- One-sentence **end state** description (not step-by-step)
- Metadata block: `depends_on`, `parallel`, `conflicts_with`, `files`
- At least one verification command per task

## Phase 9: Validate PRD

Before saving, verify:

- [ ] No placeholder text remains (e.g., "[Clear description", "[List what's allowed]")
- [ ] Success criteria include `Verify:` commands
- [ ] Technical context references actual `src/` paths from exploration
- [ ] Affected files list real paths
- [ ] Tasks have `[category]` headings
- [ ] Each task has verification
- [ ] No implementation code in the PRD
- [ ] No unresolved `[NEEDS CLARIFICATION]` markers remain (convert to Open Questions or resolve)

If any check fails, fix it — don't ask the user.

## Phase 10: Claim and Prepare Workspace

**If `--spec-only` was passed, skip to Phase 12 (Report).**

### Workspace Check

```bash
git status --porcelain
git branch --show-current
br list --status=in_progress
```

- If uncommitted changes: ask user to stash, commit, or continue
- If other tasks in progress: warn before claiming another

### Claim Bead

```bash
br update $BEAD_ID --status in_progress
```

### Choose Workspace Mode

```typescript
ask_user_question({
  questions: [
    {
      header: "Workspace",
      question: "How do you want to set up the workspace?",
      options: [
        {
          label: "Create feature branch (Recommended)",
          description: "git checkout -b feat/<bead-id>-<title>",
        },
        {
          label: "Use current branch",
          description: "Work on current branch",
        },
        {
          label: "Create worktree",
          description: "Isolated git worktree for this bead",
        },
      ],
      multiSelect: false,
    },
  ],
});
```

**If feature branch selected:**

```bash
git checkout -b feat/$BEAD_ID-$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
```

**If worktree selected:**

```typescript
skill({ name: "using-git-worktrees" });
```

**If current branch:** Continue without branch creation.

## Phase 11: Convert PRD to Tasks

Use the `beads` skill to convert PRD markdown → executable JSON (`prd.json`).

If `prd.json` already exists (from partial run), show progress (completed/total tasks).

## Phase 12: Report and Route

Output:

1. Bead ID, type, and status
2. Pre-flight result (workspace status)
3. PRD location (`.beads/artifacts/$BEAD_ID/prd.md`)
4. PRD validation result
5. Summary: task count, success criteria count, affected files count
6. Branch name and workspace (worktree if applicable)
7. Next action recommendation

| State | Next Command |
| --- | --- |
| Has tasks and workspace | `/ship $BEAD_ID` |
| Epic with subtasks | Start with first subtask |
| Spec-only mode | `/start` (create tasks first) then `/ship` |
| Complex, needs planning | `/plan $BEAD_ID` |

```bash
br comments add $BEAD_ID "Created prd.md with [N] tasks, [M] success criteria"
```

---

## Related Commands

| Need               | Command      |
| ------------------ | ------------ |
| Research first     | `/research`  |
| Plan after spec    | `/plan <id>` |
| Implement and ship | `/ship <id>` |
