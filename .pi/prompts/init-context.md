---
description: Initialize project planning context (roadmap, state) with optional brownfield analysis
argument-hint: "[--skip-questions] [--brownfield]"
---

# Init-Context: $ARGUMENTS

Initialize project planning context files from templates.

## Architecture

**Auto-injected files** (always loaded into every prompt via `instructions[]`):
- `user.md` — identity, preferences
- `tech-stack.md` — framework, constraints
- `project.md` — vision, success criteria, principles
- `git-context.md` — spatial awareness

**On-demand files** (created by this command, loaded via `memory-read` when needed):
- `roadmap.md` — phases, milestones, bead planning
- `state.md` — current position, blockers, next actions

> **Warning:** Do NOT add roadmap.md or state.md to `instructions[]`. Per-prompt injection of too many files causes session OOM crashes. Use `memory-read({ file: "project/roadmap" })` or `memory-read({ file: "project/state" })` when needed.

## Load Skills

```typescript
skill({ name: "context-engineering" });
skill({ name: "brainstorming" });
skill({ name: "verification-before-completion" });
```

## Parse Arguments

```typescript
const args = {
  skipQuestions: $ARGUMENTS.includes("--skip-questions"),
  brownfield: $ARGUMENTS.includes("--brownfield"),
  focus: $ARGUMENTS.match(/--focus=(\w+)/)?.[1], // Optional: api, ui, db, etc.
};
```

## Phase 1: Discovery

### 1.1 Check Existing Context

Use srcwalk_read or built-in read to check for existing files:

```typescript
srcwalk_files({ pattern: "*.md", scope: ".pi/memory/project" });
// Or: srcwalk_read({ path: ".pi/memory/project/project.md" });
```

**If planning context exists:**

```
Existing planning context found:
- project.md: [exists/size] (auto-injected)
- roadmap.md: [exists/size] (on-demand)
- state.md: [exists/size] (on-demand)

Options:
1. Refresh - Delete and recreate from templates
2. Update - Keep existing, only update state.md
3. Skip - Use existing context as-is
```

Wait for user selection.

### 1.2 Brownfield Codebase Analysis (if --brownfield)

If `--brownfield` flag is set:

```typescript
skill({ name: "agent-teams" });

// Agent 1: Map tech stack
Agent({
  subagent_type: "explore",
  description: "Analyze tech stack",
  prompt:
    "Analyze the codebase technology stack. Write findings to .pi/memory/project/codebase/tech-analysis.md covering: languages, frameworks, dependencies, build tools. Return file path and line count only.",
});

// Agent 2: Map architecture
Agent({
  subagent_type: "explore",
  description: "Analyze architecture",
  prompt:
    "Analyze the codebase architecture. Write findings to .pi/memory/project/codebase/arch-analysis.md covering: patterns, directory structure, entry points. Return file path and line count only.",
});

// Wait for agents and collect confirmations
```

## Phase 2: Requirements Gathering

### 2.1 Brainstorming (if not --skip-questions)

```typescript
if (!args.skipQuestions) {
  // brainstorming skill already loaded in Load Skills phase
  // Follow brainstorming process for project vision
  // Ask questions one at a time (as per brainstorming skill)
  // Output: Refined vision, success criteria, target users
}
```

### 2.2 Quick Mode (if --skip-questions)

Use template defaults with placeholders for:

- Project vision
- Success criteria
- Target users
- Phases
- Current phase

## Phase 3: Document Creation

### 3.1 Update project.md (auto-injected)

This file is auto-injected into every prompt. Keep it concise.

**Load template:**

```typescript
srcwalk_read({ path: ".pi/memory/_templates/project.md" });
```

**Fill with gathered data:**

- Vision from brainstorming OR template placeholder
- Success criteria (3-7 measurable outcomes)
- Target users (primary/secondary)
- Core principles (convention over config, minimal, extensible)
- Current phase (from user input or template default)

**Write using memory tools:**

```typescript
memory-update({ file: "project/project", content: filledContent, mode: "replace" });
```

### 3.2 Create roadmap.md (on-demand)

This file is NOT auto-injected. Access via `memory-read({ file: "project/roadmap" })`.

**Parse phases from input:**

```typescript
// Convert user-provided phases into structured roadmap
// Example: "Discovery, MVP, Launch, Scale" → table rows
```

**Structure:**

```markdown
| Phase     | Goal   | Status   | Beads |
| --------- | ------ | -------- | ----- |
| [Phase 1] | [Goal] | [Status] | [#]   |
```

**Write using memory tools:**

```typescript
memory-update({ file: "project/roadmap", content: roadmapContent, mode: "replace" });
```

### 3.3 Create state.md (on-demand)

This file is NOT auto-injected. Access via `memory-read({ file: "project/state" })`.

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

**Write using memory tools:**

```typescript
memory-update({ file: "project/state", content: stateContent, mode: "replace" });
```

### 3.4 Brownfield Analysis Integration (if applicable)

If `--brownfield` analysis was run:

```typescript
// Append tech/arch findings to project.md Context Notes section
// Or create separate .pi/memory/project/codebase/ documents
```

## Phase 4: Verification & Security

### 4.1 Verify Documents Created

```typescript
srcwalk_files({ pattern: "*.md", scope: ".pi/memory/project" });
// Verify each file exists and has content
srcwalk_read({ path: ".pi/memory/project/project.md" });
srcwalk_read({ path: ".pi/memory/project/roadmap.md" });
srcwalk_read({ path: ".pi/memory/project/state.md" });
```

**Check:**

- [ ] project.md exists and >20 lines
- [ ] roadmap.md exists and >20 lines
- [ ] state.md exists and >20 lines
- [ ] All files are readable

### 4.2 Secret Scan

```bash
# Scan for accidentally leaked secrets in generated docs
grep -rE '(sk-[a-zA-Z0-9]{20,}|sk_live_[a-zA-Z0-9]+|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]{36}|xoxb-[a-zA-Z0-9-]+|-----BEGIN.*PRIVATE KEY)' .pi/memory/project/*.md 2>/dev/null && SECRETS_FOUND=true || SECRETS_FOUND=false
```

**If secrets found:** Alert user and pause before proceeding.

### 4.3 Run Verification

```typescript
// verification-before-completion skill already loaded
// Run verification checklist:
// 1. IDENTIFY: Files created, structure valid
// 2. RUN: Validation commands
// 3. READ: Check file contents
// 4. VERIFY: All success criteria met
// 5. CLAIM: Context initialization complete
```

## Output

Creates planning context in `.pi/memory/project/`:

| File         | Purpose                                  | Injection   | Access                                       |
| ------------ | ---------------------------------------- | ----------- | -------------------------------------------- |
| `project.md` | Vision, success criteria, principles     | Auto-injected | Updated in-place (already in `instructions[]`) |
| `roadmap.md` | Phases, milestones, bead planning        | On-demand   | `memory-read({ file: "project/roadmap" })`   |
| `state.md`   | Current position, blockers, next actions | On-demand   | `memory-read({ file: "project/state" })`     |

**If `--brownfield`:**
Additional files in `.pi/memory/project/codebase/`:

- `tech-analysis.md` - Stack and dependencies
- `arch-analysis.md` - Architecture patterns

## Success Criteria

- [ ] All planning documents created from templates
- [ ] Documents follow template structure
- [ ] No secrets leaked in generated files
- [ ] Files pass basic validation (readable, non-empty)
- [ ] User informed of next steps and access patterns

## Custom Context (Optional)

Inform user about `.pi/context/` for additional project-specific context:

```
Custom context folder available at .pi/context/
- Add .md files with architecture decisions, domain knowledge, team agreements
- This folder is preserved during init --force and upgrade

⚠️  Only add files to instructions[] if they are essential for EVERY prompt.
    Per-prompt injection adds ~2-4KB each. Too many files cause session OOM.
    Prefer memory-read() for on-demand access instead.
```

## Next Steps

After init-context completes:

1. **For new projects:** Use `/plan` to create first implementation plan
2. **For brownfield:** Review codebase analysis, then `/plan`
3. **For existing beads:** Use `/resume` to continue tracked work
4. **For custom context:** Add `.md` files to `.pi/context/` (on-demand via Read, not auto-injected)

---

## Skill Integration Summary

| Skill                            | When Used                         | Purpose                        |
| -------------------------------- | --------------------------------- | ------------------------------ |
| `context-engineering`            | Phase 1                           | Template and context discipline |
| `brainstorming`                  | Phase 2 (if not --skip-questions) | Refine vision and requirements |
| `agent-teams`                    | Phase 1.2 (if --brownfield)       | Parallel codebase analysis     |
| `verification-before-completion` | Phase 4                           | Validate created files         |
