---
name: development-lifecycle
description: "Orchestrates the full feature development lifecycle from idea to verified handoff. Use for significant features, risky refactors, migrations, or unclear product changes that need Compose-style structure: clarify/spec -> decide -> plan -> implement -> review -> verify."
version: 2.0.0
tags: [workflow, planning, compose]
dependencies:
  - brainstorming
  - grill-me
  - documentation-and-adrs
  - spec-driven-development
  - source-driven-development
  - planning-and-task-breakdown
  - test-driven-development
  - testing-anti-patterns
  - incremental-implementation
  - code-review-and-quality
  - deep-module-design
  - security-and-hardening
  - quality-loop
  - verification-before-completion
  - shipping-and-launch
agent_types: [planner, worker, reviewer]
tools: []
---

# Development Lifecycle

This is the lightweight Compose-mode wrapper for Pi. It is **not** a runtime mode, workflow engine, or subagent. It tells the main agent when to use the full lifecycle and which existing skills/artifacts to use at each phase.

## Use When

- Starting a new feature, migration, architecture change, or risky refactor
- Requirements are unclear enough that coding first would create churn
- Work touches multiple files or has user-visible behavior
- You need explicit planning, review, and verification evidence before completion

## Do Not Use When

- One-line/mechanical fix
- Obvious config tweak
- Docs-only typo or small wording update
- User explicitly asks for a quick prototype or investigation only
- A more specific skill directly matches the task and lifecycle ceremony adds no value

## Entry Decision

Announce the route before acting:

- **Mechanical** → implement directly, no lifecycle.
- **Clear but non-trivial** → start at Phase 3: Plan.
- **Unclear/risky/new feature** → start at Phase 1: Clarify/Spec.
- **Architectural/refactor/migration** → start at Phase 2: Decide.
- **Stuck or assumptions feel shaky** → stop coding and start Phase 1 or Grill.

## Artifact Contract

For lifecycle work, create a fresh artifact directory:

```
.pi/artifacts/<id>/
  SPEC.md       # requirements, scope, acceptance criteria
  ADR.md        # optional; required for architecture/migration/risky decisions
  PLAN.md       # implementation plan with Discovery section
  TODO.md       # checkbox task list; one atomic action per line
  PROGRESS.md   # narrative notes, decisions, blockers, verification evidence
  REVIEW.md     # review findings and resolution status
  VERIFY.md     # final verification commands and outputs
```

Minimum required by project policy for non-trivial work: `PLAN.md`, `TODO.md`, `PROGRESS.md`. Add the rest when the phase exists.

## Phase 1: Clarify / Specify

**Load when needed:** `brainstorming`, `spec-driven-development`, optionally `grill-me`.

Goal: turn vague intent into explicit scope.

Actions:
1. Ask only outcome-changing questions.
2. State assumptions if proceeding without answers.
3. Define in/out of scope.
4. Define acceptance criteria and verification signals.
5. Write `.pi/artifacts/<id>/SPEC.md`.

Exit criteria:
- Acceptance criteria are testable.
- Major ambiguities are resolved or marked blocked.

## Phase 2: Decide / ADR

**Load when needed:** `grill-me`, `documentation-and-adrs`, `source-driven-development` when external APIs/libraries matter.

Goal: make risky decisions explicit before code.

Actions:
1. Challenge assumptions, compatibility, migration, data model, and rollback risk.
2. Compare 2-3 viable approaches when the choice matters.
3. Choose the smallest maintainable design.
4. Write `ADR.md` for architecture, migration, public API, storage, or irreversible decisions.

Exit criteria:
- Decision and tradeoffs are documented.
- User approval is obtained when behavior or architecture materially changes.

## Phase 3: Plan

**Load when needed:** `planning-and-task-breakdown`, `test-driven-development`, `incremental-implementation`.

Goal: create an executable plan, not a vague roadmap.

Actions:
1. Read current code before proposing edits.
2. Search before creating new utilities or abstractions.
3. Break work into thin verified slices.
4. Name tests/commands that prove each slice.
5. Write/update `PLAN.md` with `## Discovery` and `TODO.md` with checkboxes.

Exit criteria:
- Every TODO item is atomic and verifiable.
- Verification commands are known before implementation.

## Phase 4: Implement

**Load when needed:** `incremental-implementation`, `test-driven-development`, `testing-anti-patterns` when tests/mocks are involved.

Goal: build in the smallest safe slices.

Actions:
1. Check off TODO step before starting it.
2. Prefer test-first for behavior changes.
3. Read target code before editing.
4. Keep diffs scoped to the current request.
5. Update `PROGRESS.md` with decisions, blockers, and evidence.
6. Stop and re-plan after two failed attempts on the same approach.

Exit criteria:
- All TODO items for the implemented scope are checked.
- Behavior changes have meaningful tests or a documented reason tests are impossible.

## Phase 5: Review

**Load when needed:** `code-review-and-quality`, `deep-module-design`, `security-and-hardening` when relevant.

Goal: find correctness and design problems before claiming done.

Actions:
1. Review diff, not memory.
2. Check scope creep, duplication, dead code, defensive patching, and runtime edge cases.
3. Write `REVIEW.md` for non-trivial work.
4. Fix blocking review issues or explicitly mark deferred with rationale.

Exit criteria:
- No known blocking correctness, schema, security, or integration issues remain.

## Phase 6: Verify / Handoff

**Load when needed:** `quality-loop`, `verification-before-completion`, `shipping-and-launch` for commit/release/deploy.

Goal: evidence before assertions.

Actions:
1. Run scoped tests first, then broader checks when practical.
2. For TS/JS work, run the Fallow gate when available.
3. Record exact commands and results in `VERIFY.md` or `PROGRESS.md`.
4. If repo-wide checks fail due to pre-existing issues, prove touched files are clean and list what remains out of scope.
5. Only then report completion.

Exit criteria:
- Fresh verification evidence exists.
- Remaining issues are explicit, scoped, and not hidden.

## Delegation Rules

Use `task` only when fresh context or parallel specialist review improves correctness:

- Good: independent code review, focused research, parallel audit, isolated implementation slice.
- Bad: trivial edits, interactive requirement discovery, tasks that need hidden current-session state.

Every delegated task must request the XML result format required by the project task protocol. Never trust delegated output blindly; inspect files, review diff, and verify yourself.

## Phase Skipping

Skip ceremony aggressively when it does not reduce risk:

- Bug fix with known root cause → Plan briefly, implement, verify.
- Small refactor → Plan + Implement + Verify.
- Risky architecture/migration → Decide + Spec + Plan + Implement + Review + Verify.
- Product feature → Clarify + Decide if needed + Spec + Plan + Implement + Review + Verify.

## Anti-Patterns

- Creating a new workflow engine instead of using artifacts and skills.
- Spawning a “compose subagent” to orchestrate work the main agent must own.
- Writing plans without reading code.
- Treating `TODO.md` as optional.
- Claiming complete after one narrow command when broader gates are available.
- Keeping ADRs or specs as ceremony after they stop reducing risk.

## Example Minimal Lifecycle

```
.pi/artifacts/user-settings-panel/
  SPEC.md      # settings panel behavior and acceptance criteria
  PLAN.md      # discovery + implementation slices
  TODO.md      # - [ ] Add route; - [ ] Add form; - [ ] Add tests
  PROGRESS.md  # decisions and verification notes
  REVIEW.md    # review findings
  VERIFY.md    # test/lint/typecheck output
```

Final report should cite changed files, verification commands, and any remaining out-of-scope issues.
