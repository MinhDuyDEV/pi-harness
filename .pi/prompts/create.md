---
description: Create a file-backed work spec and prepare a visible implementation artifact
argument-hint: "<description> [--type epic|feature|task|bug] [--spec-only]"
---

# Create: $ARGUMENTS

Create a durable work artifact under `.pi/plans/<id>/` — no hidden task extension, no external orchestration.

> **Workflow:** `/create` → `/plan <id>` when needed → `/ship <id>`
>
> Use `--spec-only` to write the spec without changing branch/workspace.

## Load Skills

```typescript
skill({ name: "spec-driven-development" });
skill({ name: "using-git-worktrees" }); // only if isolated workspace is requested
```

## Rules

- Do not use external issue-tracker CLIs, hidden task tools, or hidden worker orchestration.
- Do not implement code in this command.
- Prefer direct repo inspection, memory search, and visible files.
- If research needs fresh context, write a brief file and explicitly self-spawn Pi via tmux/`pi --print-turn`; require written output before trusting it.

## Phase 1: Pre-flight

```bash
git status --porcelain
git branch --show-current
find .pi/plans -maxdepth 2 -name SPEC.md -print 2>/dev/null
```

- If uncommitted changes exist, ask whether to continue.
- If a similar `.pi/plans/<id>/SPEC.md` exists, stop and recommend `/ship <id>` or `/plan <id>`.
- If current branch is `main`/`master`, recommend a feature branch or worktree.

## Phase 2: Choose ID and Type

Derive a stable slug ID from the title:

```bash
WORK_ID=$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-|-$//g' | cut -c1-48)
mkdir -p ".pi/plans/$WORK_ID"
```

Classify type:

- **epic**: multi-session, cross-domain
- **feature**: new capability
- **bug**: broken behavior
- **task**: tactical scoped change

## Phase 3: Gather Context

Use direct tools first:

```bash
git log --oneline -20
find . -maxdepth 3 -type f | sed 's#^./##' | sort | head -200
```

Use `srcwalk_*` tools when available for code discovery. Record important findings in the spec.

## Phase 4: Write Spec

Write `.pi/plans/$WORK_ID/SPEC.md`.

### Lite Spec

Use for clear bugs/tasks:

```markdown
# [Title]

**ID:** [work-id]
**Type:** bug|task|feature|epic
**Status:** planned

## Problem
[What is wrong or needed]

## Solution
[What should change]

## Affected Files
- `path/to/file`

## Tasks
- [ ] [Task] — Verify: [command]

## Success Criteria
- Verify: [command]
```

### Full Spec

Use for features/epics:

```markdown
# [Title]

**ID:** [work-id]
**Type:** feature|epic
**Status:** planned

## Goal
[Outcome]

## Non-goals
[Explicitly out of scope]

## Context
[Findings from repo/docs/memory]

## Proposed Solution
[Approach]

## Affected Files
- `path/to/file`

## Tasks
- [ ] [Vertical slice task] — Files: [...] — Verify: [command]

## Risks
- [Risk and mitigation]

## Success Criteria
- Verify: [command]
```

## Phase 5: Validate Spec

Before reporting, verify:

- [ ] No placeholders remain.
- [ ] Tasks are vertical slices, not vague phases.
- [ ] Every task has a verification command.
- [ ] Affected files are real or intentionally new.
- [ ] Open questions are explicit.

## Phase 6: Optional Workspace

If not `--spec-only`, ask whether to use current branch, create a feature branch, or create a worktree. Do not change workspace without confirmation.

## Output

Report:

1. Work ID
2. Spec path: `.pi/plans/<id>/SPEC.md`
3. Type and status
4. Task count and success criteria
5. Recommended next command: `/plan <id>` or `/ship <id>`
