---
description: Initialize GSD-style project planning context
---

# Init-Context: $@

Initialize GSD-style project planning context files.

## Parse Arguments

Check for these flags in `$@`:

- `--skip-questions`: Skip interactive questions, use template defaults
- `--brownfield`: Analyze an existing codebase before creating context

## Phase 1: Discovery

### 1.1 Check Existing Context

```bash
ls docs/ 2>/dev/null && HAS_CONTEXT=true || HAS_CONTEXT=false
cat docs/project.md 2>/dev/null | head -20
```

**If context exists**, show the user what exists and ask them to choose:

1. Refresh — Delete and recreate
2. Update — Keep existing, only update state.md
3. Skip — Use existing context as-is

Wait for user selection.

### 1.2 Brownfield Codebase Analysis (if --brownfield)

Analyze the codebase sequentially:

**Step 1: Map tech stack**
Analyze the technology stack. Write findings to `docs/tech-analysis.md` covering: languages, frameworks, dependencies, build tools.

**Step 2: Map architecture**
Analyze the codebase architecture. Write findings to `docs/arch-analysis.md` covering: patterns, directory structure, entry points.

## Phase 2: Requirements Gathering

### 2.1 Interactive Mode (if not --skip-questions)

Ask questions one at a time to understand the project:

1. What is the project's core purpose or vision?
2. What are the key success criteria (3-7 measurable outcomes)?
3. Who are the target users?
4. What phases is the project divided into?
5. Which phase is currently active?

Build understanding incrementally. Each answer informs the next question. Output: Refined vision, success criteria, target users, phases.

### 2.2 Quick Mode (if --skip-questions)

Use template defaults with placeholders for:

- Project vision
- Success criteria
- Target users
- Phases
- Current phase

## Phase 3: Document Creation

```bash
mkdir -p docs
```

### 3.1 Create project.md

**Fill with gathered data:**

- Vision from brainstorming OR template placeholder
- Success criteria (3-7 measurable outcomes)
- Target users (primary/secondary)
- Core principles (convention over config, minimal, extensible)
- Current phase (from user input or template default)

**Write to:** `docs/project.md`

### 3.2 Create roadmap.md

Convert user-provided phases into a structured roadmap table:

```markdown
| Phase     | Goal   | Status   | Beads |
| --------- | ------ | -------- | ----- |
| [Phase 1] | [Goal] | [Status] | [#]   |
```

**Write to:** `docs/roadmap.md`

### 3.3 Create state.md

**Initialize with:**

- Active Bead: (blank or from bead context)
- Status: In Progress
- Started: [current date]
- Phase: [from roadmap]
- Recent Completed Work: (empty table)
- Active Decisions: (empty table)
- Blockers: (empty table)
- Open Questions: (empty table)
- Next Actions: (empty list)

**Write to:** `docs/state.md`

### 3.4 Brownfield Analysis Integration (if applicable)

If `--brownfield` analysis was run, append tech/arch findings to the project.md Context Notes section, or reference the separate `docs/tech-analysis.md` and `docs/arch-analysis.md` files.

## Phase 4: Verification

### 4.1 Verify Documents Created

```bash
ls -la docs/
wc -l docs/*.md
```

**Check:**

- [ ] project.md exists and >20 lines
- [ ] roadmap.md exists and >20 lines
- [ ] state.md exists and >20 lines
- [ ] All files are readable

### 4.2 Secret Scan

```bash
grep -E '(sk-[a-zA-Z0-9]{20,}|sk_live_[a-zA-Z0-9]+|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]{36}|-----BEGIN.*PRIVATE KEY)' docs/*.md 2>/dev/null && echo "SECRETS FOUND - alert user" || echo "No secrets found"
```

**If secrets found:** Alert user and pause before proceeding.

### 4.3 Final Verification

Before declaring completion, confirm:

1. All files were created at expected paths
2. File contents are non-empty and follow template structure
3. No secrets were leaked
4. All success criteria are met

## Phase 5: Beads Integration

```bash
# If user wants to track context setup as a bead
br create "Initialize project context" --type=task
br update <bead-id> --status closed --reason="Context files created"
```

## Output

Creates in `docs/`:

| File         | Purpose                                  | Lines (typical) |
| ------------ | ---------------------------------------- | --------------- |
| `project.md` | Vision, success criteria, principles     | 50-100          |
| `roadmap.md` | Phases, milestones, bead planning        | 80-150          |
| `state.md`   | Current position, blockers, next actions | 60-100          |

**If `--brownfield`:**
Additional files in `docs/`:

- `tech-analysis.md` - Stack and dependencies
- `arch-analysis.md` - Architecture patterns

## Success Criteria

- [ ] All required documents created
- [ ] Documents follow structured format
- [ ] No secrets leaked in generated files
- [ ] Files pass basic validation (readable, non-empty)
- [ ] User informed of next steps

## Next Steps

After init-context completes:

1. **For new projects:** Use `/plan` to create first implementation plan
2. **For brownfield:** Review codebase analysis, then `/plan`
3. **For existing beads:** Use `/resume` to continue tracked work
