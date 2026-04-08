---
name: brainstorming
description: Use when creating or developing, before writing code or implementation plans - refines rough ideas into fully-formed designs through collaborative questioning, alternative exploration, and incremental validation. Don't use during clear 'mechanical' processes
version: 1.0.0
tags: [planning, workflow]
dependencies: []
---

# Brainstorming Ideas Into Designs

> **Replaces** jumping straight to implementation without exploring alternatives, constraints, or edge cases
## When to Use

- You have a rough idea that needs clarification into a design or spec
- You need to explore multiple approaches and validate trade-offs before coding

## When NOT to Use

- Requirements are already clear and execution is mechanical
- You are already in implementation with a validated plan or PRD

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design in small sections (200-300 words), checking after each section whether it looks right so far.

**Part of:** `development-lifecycle` skill (Phase 1: Ideation)

**Output template:** `.opencode/memory/_templates/design.md`

## The Process

**Understanding the idea:**

- Check out the current project state first (files, docs, recent commits)
- Ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- Only one question per message - if a topic needs more exploration, break it into multiple questions
- Focus on understanding: purpose, constraints, success criteria

**Exploring approaches:**

- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**Presenting the design:**

- Once you believe you understand what you're building, present the design
- Break it into sections of 200-300 words
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

## After the Design

**Documentation:**

- Write the validated design to `.beads/artifacts/<bead-id>/design.md`
- Use template from `.opencode/memory/_templates/design.md`
- Use elements-of-style:writing-clearly-and-concisely skill if available
- Commit the design document to git

**Next Phase (if continuing):**

- Ask: "Ready to create the PRD?"
- Load next skill: `skill({ name: "prd" })`
- This moves to Phase 2: Specification

**Alternative paths:**

- Use `skill({ name: "using-git-worktrees" })` to create isolated workspace first
- Use `skill({ name: "writing-plans" })` if skipping formal PRD

**Full lifecycle reference:**

- Use `skill({ name: "development-lifecycle" })` to see all phases

## Key Principles

- **One question at a time** - Don't overwhelm with multiple questions
- **Multiple choice preferred** - Easier to answer than open-ended when possible
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design in sections, validate each
- **Be flexible** - Go back and clarify when something doesn't make sense

## Example Flow

**User request**: "Add dark mode to the app"

**Good brainstorming questions**:
1. "Should dark mode be system-preference-aware, manual toggle, or both?"
2. "Where does theme state live — CSS variables, React context, localStorage?"
3. "Are there existing color tokens, or do we need to create a design token system?"
4. "What about images/icons — do they need dark variants?"

**Bad brainstorming** (jumping to solution):
1. "I'll add a ThemeContext with useState and toggle button" ← skipped alternatives

## Anti-Patterns

| Anti-Pattern | Why It Fails | Instead |
| --- | --- | --- |
| Asking questions the codebase can answer (search first) | Wastes turns and slows decisions; signals weak preparation | Do quick repo/docs lookup first, then ask only unresolved questions |
| Brainstorming during mechanical/routine tasks | Adds overhead when execution is already clear | Skip to execution using the relevant implementation skill |
| Generating 10+ alternatives without narrowing criteria | Creates analysis paralysis and no decision pressure | Present 2-3 viable options with explicit decision criteria |
| Continuing to brainstorm after a clear direction emerges | Burns time and erodes momentum | Confirm direction, summarize decisions, transition to PRD/plan |

## See Also

- `writing-plans` - Turn validated direction into zero-ambiguity implementation tasks
- `prd` - Capture behavioral requirements before implementation
