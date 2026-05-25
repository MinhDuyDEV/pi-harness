---
name: development-lifecycle
description: Orchestrates the full feature development lifecycle from ideation through verification. Guides through phases (brainstorm → grill → ADR → specify → plan → implement → verify) and loads appropriate sub-skills at each stage.
version: 1.0.0
tags: [workflow, planning]
dependencies:
  - brainstorming
  - grill-me
  - documentation-and-adrs
  - spec-driven-development
agent_types: [planner, worker, reviewer]
tools: []
---

---

# Development Lifecycle Orchestration

## When to Use

- Starting a new feature, migration, or refactor and need the full end-to-end workflow
- You want phase-by-phase guidance with the correct sub-skill at each stage

## When NOT to Use

- You are already mid-phase and only need a specific sub-skill
- The change is trivial and can skip the full lifecycle

## Entry Decision — Engage Lifecycle or Not?

This decision tree fires when Behavioral Kernel rule #6 says "this might need a lifecycle." Use it to pick the right entry point.

```
Is this request mechanically simple?
├── YES → one-liner, known fix, obvious rename.
│         Just implement. No lifecycle needed.
│
├── PARTIALLY → refactor, migration, or goal is clear
│                but approach isn't.
│         Start at Phase 2 (Grill) or Phase 3 (ADR).
│         Skip brainstorming — idea is already formed.
│
├── NO → new feature, risky change, unclear requirements.
│        Start at Phase 1 (Ideation). Full lifecycle.
│
└── UNSURE / I'M STRUGGLING → STOP CODING.
         Start at Phase 2 (Grill).
         Struggle means an upstream assumption is wrong.
         Grilling will surface it cheaper than debugging.

Is this a prototype or throwaway experiment?
├── YES → skip the lifecycle. Move fast.
└── NO → keep going through the decision tree above.
```

**Announce your decision up front.** Say either:
- "This is mechanical — I'll implement directly."
- "I'm using development-lifecycle for this — starting at Phase X."

## Overview

This skill orchestrates the complete feature development workflow, guiding you through each phase and loading the appropriate sub-skills automatically.

**Note:** For quick skill routing by intent, use `docs/skills-registry.md`, `skills/registry.json`, or the `using-pi-skills` skill. This skill is for full end-to-end orchestration when you need phase-by-phase guidance.

**Use when:** Starting any new feature, migration, refactor, or significant change.

**Announce at start:** "I'm using development-lifecycle to guide this work through all phases."

## The Lifecycle

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  IDEATION   │───▶│   GRILL     │───▶│   DECISION  │───▶│ SPECIFICATION│───▶│   PLANNING  │───▶│IMPLEMENTATION│
│ brainstorming│   │  grill-me   │    │   ADR       │    │   prd.md    │    │  tasks.md   │    │executing-plans│
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                          │                  │                  │                  │                  │
                          └──────────────────┴──────────────────┴──────────────────┴──────────────────┤
                                              │                                     ▼
                                    ┌─────────────────┐                   ┌─────────────┐
                                    │    RESEARCH     │                   │VERIFICATION │
                                    │   (optional)    │                   │verification-│
                                    │ /research cmd   │                   │before-      │
                                    └─────────────────┘                   │completion   │
                                                                          └─────────────┘
```

**Note:** Research (`/research <bead-id>`) can happen at any phase when you need external information or deeper codebase understanding. It's not a sequential step but a parallel activity.

## Phase 1: Ideation (brainstorming)

### Phase 1 Checklist

- [ ] Load `brainstorming`
- [ ] Validate design with user
- [ ] Write `.beads/artifacts/<bead-id>/design.md`

**When:** You have a rough idea but need to explore and refine it.

**Entry criteria:** User has an idea or problem to solve.

**Process:**

1. Understand current project context
2. Ask questions one at a time (prefer multiple choice)
3. Explore 2-3 approaches with trade-offs
4. Present design in 200-300 word sections

**Exit criteria:**

- Design validated by user
- Output: `.beads/artifacts/<bead-id>/design.md`

**Template:** `.pi/templates/design.md` or `.pi/memory/_templates/design.md`

---

## Phase 2: Grill (grill-me)

### Phase 2 Checklist

- [ ] Load `grill-me`
- [ ] Question every assumption, ambiguity, and hand-wave
- [ ] Resolve all open questions or flag blockers explicitly
- [ ] Summarize: should this idea survive, be reworked, or be killed?

**When:** The idea has been explored during brainstorming. Now it needs to be stress-tested before committing.

**Entry criteria:** Rough idea or validated design exists.

**Process:**

1. Load `grill-me`
2. Systematically interrogate the idea: ambiguity, hidden assumptions, missing constraints, hand-waving, integration risks
3. For each question: present to user → get resolution → record decision
4. Continue until questions repeat or added precision stops changing the plan

**Exit criteria:**

- All questions either resolved or flagged as blockers
- Clear assessment: ready for ADR / needs rework / kill the idea
- Recommended next step documented

---

## Phase 3: Decision (ADR)

### Phase 3 Checklist

- [ ] Write Architecture Decision Record
- [ ] Record: what was decided, why, what tradeoffs were accepted
- [ ] Keep ADR as permanent artifact (unlike spec/PRD which may be disposable)

**When:** Grilling is complete and the idea has survived scrutiny.

**Entry criteria:** Grill summary exists with "ready for ADR" assessment.

**Process:**

1. Capture every decision made during grilling
2. Write ADR with: context, decision, rationale, consequences, tradeoffs accepted
3. Present ADR to user for approval
4. User edits and approves the ADR
5. ADR becomes the contract: "this decision is buildable"

**Exit criteria:**

- ADR written and user-approved
- Output: `.beads/artifacts/<bead-id>/adr.md`
- Design document (from Phase 1) archived or merged into ADR

**See Also:** `documentation-and-adrs` skill for ADR format

---

## Phase 4: Specification (prd)

### Phase 4 Checklist

- [ ] Confirm or create bead id
- [ ] Write `.beads/artifacts/<bead-id>/prd.md` (or spec.md for technical work)
- [ ] Decide: is this user-facing (PRD) or technical (spec)?

**When:** ADR is approved, need formal requirements.

**Entry criteria:** Approved ADR exists.

**Process:**

1. For user-facing changes: write PRD (who this is for, what behavior changes, how we know it worked)
2. For technical changes: write spec (behaviors being added/changed/removed, API boundaries, migration path)
3. Both documents should reference the ADR

**Exit criteria:**

- PRD or spec with all sections completed
- Output: `.beads/artifacts/<bead-id>/prd.md` or `.beads/artifacts/<bead-id>/spec.md`

**Template:** `.pi/templates/prd.md` or `.pi/memory/_templates/prd.md`

**Note:** The spec/PRD can be discarded after implementation. The ADR is the permanent record.

---

## Phase 5: Task Conversion (prd-task)

### Phase 3 Checklist

- [ ] Read PRD from `.beads/artifacts/<bead-id>/prd.md`
- [ ] Generate `.beads/artifacts/<bead-id>/prd.json`
- [ ] Ensure `progress.txt` exists

**When:** PRD is complete, need executable task list.

**Entry criteria:** PRD exists at `.beads/artifacts/<bead-id>/prd.md`.

**Process:**

1. Read PRD and extract ## Tasks section
2. Convert to JSON format with dependencies
3. Create progress.txt for cross-iteration memory

**Exit criteria:**

- JSON task file created
- Progress file initialized
- Output: `.beads/artifacts/<bead-id>/prd.json`, `progress.txt`

---

## Phase 6: Planning (writing-plans)

### Phase 4 Checklist

- [ ] Create bite-sized tasks with exact file paths
- [ ] Include TDD steps and verification commands
- [ ] Write `.beads/artifacts/<bead-id>/plan.md`

**When:** Tasks defined, need detailed implementation instructions.

**Entry criteria:** Task list exists (prd.json or tasks.md).

**Process:**

1. Create bite-sized steps (2-5 min each)
2. Include exact file paths, complete code
3. TDD: write failing test → verify fail → implement → verify pass → commit
4. Add verification commands for each step

**Exit criteria:**

- Detailed plan ready for execution
- Output: `.beads/artifacts/<bead-id>/plan.md`

**Template:** `.pi/templates/tasks.md` or `.pi/memory/_templates/tasks.md` (for task structure reference)

---

## Phase 7: Implementation (executing-plans)

### Phase 5 Checklist

- [ ] Load and review plan
- [ ] Execute in batches with verification
- [ ] Report for feedback between batches

**When:** Plan is ready, time to build.

**Entry criteria:** Plan exists at `.beads/artifacts/<bead-id>/plan.md`.

**Process:**

1. Load and review plan critically
2. Execute in 3-task batches
3. Report for feedback between batches
4. Stop on blockers, don't guess

**Exit criteria:**

- All tasks completed
- All verifications pass
- Ready for final verification

---

## Phase 8: Verification (verification-before-completion)

### Phase 6 Checklist

- [ ] Identify verification commands
- [ ] Run full verification suite
- [ ] Only then claim completion and close bead

**When:** Implementation complete, before claiming done.

**Entry criteria:** All implementation tasks marked complete.

**Process:**

1. IDENTIFY: What commands prove completion?
2. RUN: Execute full verification suite fresh
3. READ: Check output, count failures
4. VERIFY: Does output confirm the claim?
5. ONLY THEN: Claim completion

**Exit criteria:**

- All verification commands pass with evidence
- Bead can be closed: `br close <bead-id>`

---

## Phase Transitions

### Skipping Phases

For small changes, you can skip early phases. Use judgment — the less risky the change, the more you can skip:

- **Bug fix / trivial change:** Skip to Phase 7 (implement directly with verification)
- **Clear requirements, low risk:** Skip Phases 1-2, start at Phase 3 (ADR) or Phase 4 (Spec)
- **Simple refactor:** Skip to Phase 6 (plan) or Phase 7 (execute)

**When in doubt, don't skip grilling.** The cost of finding a bad decision after implementation is much higher than the cost of grilling upfront.

---

## Templates Reference

| Phase         | Template                 | Purpose                       |
| ------------- | ------------------------ | ----------------------------- |
| Phase         | Template (try first)      | Template (fallback)           | Purpose                       |
| ------------- | ------------------------- | ----------------------------- | ----------------------------- |
| Ideation      | `.pi/templates/design.md` | `.pi/memory/_templates/design.md` | Architecture decisions    |
| Grill         | (none — free-form interrogation) | (none)                    | Adversarial idea review       |
| Decision/ADR  | `.pi/templates/adr.md`    | `.pi/memory/_templates/adr.md`    | Permanent decision record  |
| Specification | `.pi/templates/prd.md`    | `.pi/memory/_templates/prd.md`    | Requirements + task breakdown |
| Planning      | `.pi/templates/tasks.md`  | `.pi/memory/_templates/tasks.md`  | Detailed task structure   |
| Quick Ideas   | `.pi/templates/proposal.md` | `.pi/memory/_templates/proposal.md` | Lightweight change proposals |

---

## Beads Integration

Every phase should operate within a bead context:

```bash
# Create bead for new feature
br create "Feature Name"

# Check current bead status
br show <bead-id>

# Update status as you progress
br update <bead-id> --status in_progress

# Close when complete
br close <bead-id> --reason "All verification passed"

# Sync changes
br sync --flush-only
```

---

## Example Full Workflow

```
User: "I want to add a dark mode toggle"

1. IDEATION
   → skill({ name: "brainstorming" })
   → Questions about scope, triggers, persistence
   → Design decisions documented
   → Output: .beads/artifacts/br-dark-mode/design.md

2. GRILL
   → skill({ name: "grill-me" })
   → Challenge every assumption: what about system dark mode?
     manual toggle? persistence? override per-page?
   → Resolve: manual toggle only, persisted to localStorage,
     override user preference but respect initial system value
   → Assessment: ready for ADR
   → Output: refined understanding, resolved questions

3. DECISION (ADR)
   → skill({ name: "documentation-and-adrs" })
   → Write ADR: context, decision, rationale, consequences
   → User approves ADR before moving on
   → Output: .beads/artifacts/br-dark-mode/adr.md

4. SPECIFICATION
   → skill({ name: "prd" } or write spec)
   → Full PRD/spec with requirements referencing ADR
   → Output: .beads/artifacts/br-dark-mode/prd.md

5. TASK CONVERSION
   → skill({ name: "prd-task" })
   → JSON task list with dependencies
   → Output: .beads/artifacts/br-dark-mode/prd.json

6. PLANNING
   → skill({ name: "writing-plans" })
   → Bite-sized implementation steps
   → Output: .beads/artifacts/br-dark-mode/plan.md

7. IMPLEMENTATION
   → skill({ name: "executing-plans" })
   → Execute in batches with feedback
   → All code written and committed

8. VERIFICATION
   → skill({ name: "verification-before-completion" })
   → Tests pass: ✓
   → Lint clean: ✓
   → Build succeeds: ✓
   → br close br-dark-mode --reason "Dark mode implemented and verified"
  ```

---

## Key Principles

1. **Phase-appropriate skills:** Load the right skill for each phase
2. **Evidence at every gate:** No phase transition without verification
3. **Templates guide structure:** Use templates for consistent output
4. **Beads track progress:** Every feature gets a bead
5. **Skip only when appropriate:** Small changes can skip early phases
