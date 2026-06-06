---
description: Create a file-backed work spec — clarify, design, and prepare for implementation
argument-hint: "<description> [--type epic|feature|task|bug] [--spec-only] [--design]"
---

# Create: $ARGUMENTS

Create a durable work artifact under `.pi/artifacts/<id>/` with visible files and explicit next steps.

Three phases: clarify ambiguity → (optional) explore designs → write spec → prepare workspace.

> **Workflow:** `/create` → `/plan <id>` (if plan needs detail) → `/ship <id>`
>
> Use `--spec-only` to write the spec without changing branch/workspace.
> Use `--design` for UI-heavy work that needs visual direction first.

## Load Skills

```typescript
skill({ name: "spec-driven-development" });
skill({ name: "brainstorming" });
skill({ name: "source-driven-development" });
skill({ name: "using-git-worktrees" }); // only if isolated workspace is requested
```

## Rules

- Keep all planning state in visible files under `.pi/artifacts/<id>/`.
- Do not implement code in this command.
- Inspect repo/docs/memory before asking the user for facts.
- Prefer direct repo inspection, memory search, and visible files.
- If research needs fresh context, write a brief file and explicitly self-spawn Pi via tmux/`pi --print-turn`; require written output before trusting it.

## Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<description>` | required | What to build/fix (quoted) |
| `--type` | auto | epic, feature, task, bug (auto-detect from description) |
| `--spec-only` | false | Write spec without changing workspace |
| `--design` | false | Include visual design exploration before spec |

## Phase 0: Clarify Ambiguity

**Skip if the request is already specific enough to spec.** Use when scope, constraints, or success criteria are unclear.

### Step 1: Ground

If `$ARGUMENTS` is a work ID, read existing artifacts. Otherwise, identify unknowns blocking execution.

```bash
find .pi/artifacts -maxdepth 2 -name SPEC.md -print 2>/dev/null
```

Inspect repo/docs/memory before asking the user for facts:

```bash
git log --oneline -20
```

```typescript
memory-search({ query: "$ARGUMENTS", limit: 5 });
```

### Step 2: Classify Unknowns

| Category | Meaning |
| --- | --- |
| **Scope** | Included/excluded work |
| **Constraint** | Compatibility, timeline, safety, tooling |
| **Success** | Proof of completion |
| **Preference** | Valid options requiring user choice |

### Step 3: Ask Targeted Questions

Ask the smallest useful question first. Good targets:

- Which user-visible outcome matters most?
- What must remain unchanged?
- Which tradeoff wins: speed, safety, simplicity, or completeness?
- Is there an existing artifact, issue, screenshot, or spec that controls scope?

Ask at most 2 questions at a time. Stop when the next step is obvious.

### Step 4: Produce Clarity Brief

```markdown
# Clarity Brief

**Goal:** ...
**Non-goals:** ...
**Constraints:** ...
**Success Criteria:** ...
**Remaining Open Questions:** ...
```

Keep this in working context — it feeds into the spec.

## Phase 1: Pre-flight & Duplicate Check

```bash
git status --porcelain
git branch --show-current
```

- If uncommitted changes exist, ask whether to continue or handle them first.
- If current branch is `main`/`master`, recommend a feature branch or worktree.
- Check for existing work in `.pi/artifacts/`. If a matching spec exists, suggest `/ship <id>`.

## Phase 2: Choose ID and Type

Derive a stable slug ID from the title:

```bash
TITLE=$(echo "$ARGUMENTS" | head -1)
WORK_ID=$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-|-$//g' | cut -c1-48)
mkdir -p ".pi/artifacts/$WORK_ID"
```

Classify type (auto-detect or `--type` flag):

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

Use `srcwalk_*` tools when available for code discovery.

### Research Depth (Optional)

For complex features or bug fixes, ask the user about research depth:

```typescript
ask_user_question({
  questions: [
    {
      header: "Research Depth",
      question: "How much codebase research do you need?",
      options: [
        { label: "Skip (Recommended for simple changes)", description: "Use existing context only" },
        { label: "Quick scan", description: "Grep key patterns, check related files (~30s)" },
        { label: "Deep research", description: "Explore patterns, tests, deps, prior art (~2min)" },
      ],
      multiSelect: false,
    },
  ],
});
```

For deep research, note findings in the spec's Context section.

## Phase 4: Design Exploration (Only with `--design`)

For UI-heavy work that needs visual direction before spec-detail specification.

### 4a: Detect Existing Design System

```bash
find . -maxdepth 3 \( -name "globals.css" -o -name "tailwind.config.*" -o -name "components.json" \) -print 2>/dev/null
```

### 4b: State Aesthetic Direction

Before designing, state:

1. **Aesthetic direction** — style and rationale.
2. **Key characteristics** — 3 specific visual choices.

### 4c: Design Output

| Type | Output |
| --- | --- |
| Component | Variants, sizes, states, code |
| Page | Layout, sections, responsive behavior |
| System | Tokens, CSS variables, usage guidelines |

Save to `.pi/artifacts/$WORK_ID/DESIGN.md`:

```markdown
# Design: [component/page/system]

**Direction:** [aesthetic rationale]
**Key Choices:** [3 specific decisions]

## Spec
[Variants, states, tokens, or layout]

## Code
[If applicable — component code, CSS variables]
```

### 4d: Record Decision

```typescript
observation({
  type: "decision",
  title: "Design: $WORK_ID — [topic]",
  narrative: "Design direction chosen for [work]. Direction: [aesthetic rationale].",
  concepts: "design, ui, [topic]",
  confidence: "high",
});
```

## Phase 5: Write Spec

Write `.pi/artifacts/$WORK_ID/SPEC.md`.

### Lite Spec

Use for clear bugs, tasks, and simple changes:

```markdown
# [Title]

**ID:** [work-id]
**Type:** bug|task
**Status:** planned

## Problem
[What is wrong or needed — 1-2 sentences]

## Solution
[What should change — 1-2 sentences]

## Affected Files
- `path/to/file`

## Tasks
- [ ] [Task] — Verify: [command]

## Success Criteria
- Verify: [command]
- Verify: [command]
```

### Full Spec

Use for features and epics:

```markdown
# [Title]

**ID:** [work-id]
**Type:** feature|epic
**Status:** planned

## Goal
[Outcome — what success looks like]

## Non-goals
[Explicitly out of scope]

## Context
[Findings from repo/docs/memory, why this approach]

## Design
[Only if `--design` was used — link to `.pi/artifacts/<id>/DESIGN.md`]

## Proposed Solution
[Approach, key decisions, architecture notes]

## Affected Files
- `path/to/file`

## Tasks
- [ ] [Vertical slice task] — Files: [...] — Verify: [command]

## Risks
- [Risk and mitigation]

## Success Criteria
- Verify: [command]
- Verify: [command]
```

### Auto-detect Spec Level

| Signal | Lite | Full |
| --- | --- | --- |
| Scope | Single-concern | Cross-cutting, multi-system |
| Files | 1-3 | 4+ |
| Type | bug, task | feature, epic |
| Description | "Fix X in Y" | "Implement X with Y and Z" |

## Phase 6: Validate Spec

Before reporting, verify:

- [ ] No placeholders remain.
- [ ] Tasks are vertical slices, not vague phases.
- [ ] Every task has a verification command.
- [ ] Affected files are real or intentionally new.
- [ ] Open questions are explicit.
- [ ] Success criteria are outcome-shaped and verifiable.

If any check fails, fix it — don't ask the user.

## Phase 7: Optional Workspace Setup

If not `--spec-only`, ask the user:

```typescript
ask_user_question({
  questions: [
    {
      header: "Workspace",
      question: "Set up workspace for this work?",
      options: [
        { label: "Current branch (Recommended for small changes)", description: "Stay on current branch" },
        { label: "New feature branch", description: "Create and switch to a feature branch" },
        { label: "New worktree", description: "Create isolated worktree for this work" },
        { label: "Skip", description: "Set up workspace later" },
      ],
      multiSelect: false,
    },
  ],
});
```

If branch or worktree is chosen, execute the setup (subject to git safety rules — never force push).

## Phase 8: Persist

```typescript
observation({
  type: "feature",
  title: "Created: [work-id] — [title]",
  narrative: "Spec created for [title]. Type: [type]. Tasks: [N]. Files: [affected].",
  concepts: "planning, [domain]",
  confidence: "high",
  files_modified: ".pi/artifacts/$WORK_ID/SPEC.md",
});
```

## Output

Report:

1. Work ID and spec path: `.pi/artifacts/<id>/SPEC.md`
2. Design artifact path (if `--design`): `.pi/artifacts/<id>/DESIGN.md`
3. Type and status
4. Task count and success criteria
5. Remaining open questions (if any)
6. Workspace setup (if applied)
7. Recommended next command: `/plan <id>` or `/ship <id>`

## Related Commands

| Need | Command |
| --- | --- |
| Research first | `/research <topic-or-id>` |
| Plan details | `/plan <id>` |
| Execute | `/ship <id>` |
