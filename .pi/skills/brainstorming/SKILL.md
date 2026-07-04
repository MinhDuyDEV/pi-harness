---
name: brainstorming
description: Use when creating or developing, before writing code or implementation plans - refines rough ideas into fully-formed designs through collaborative questioning, alternative exploration, and incremental validation. Don't use during clear 'mechanical' processes
version: 1.0.0
tags: [planning, workflow]
dependencies: []
agent_types: [planner, worker, reviewer]
tools: []
---

# Brainstorming

<HARD-GATE>
Do not write code, draft an implementation plan, or invoke `incremental-implementation` until the user has approved a design.
</HARD-GATE>

## When to Use

- Rough idea, PRD, ADR draft, or vague feature request.
- "What if we…", "I'm thinking…", "Let's try…" — before code.
- Multiple plausible approaches exist; the choice is load-bearing.

## When NOT to Use

- Bug fixes with known root cause → `diagnose`.
- Mechanical refactor with a clear spec → `incremental-implementation`.
- Trivial one-liner or config value.

## Core Principle

**Classify unknowns before acting.** Distinguish:
- **Known knowns** — in the prompt.
- **Known unknowns** — ask the user.
- **Unknown knowns** — you'd recognize the answer if you saw it. Show 2–4 cheap variants or point at a reference.
- **Unknown unknowns** — ask the model to teach you the criteria.

Map the gap before proposing. A simpler approach often exists — say so.

## Workflow

1. **Map unknowns** — classify the gap using the four categories above. State assumptions out loud for ambiguous cases. If the request is well-defined, do not brainstorm — just fix.
2. **Variants** — for novel / design-heavy / unclear work, show 2–4 cheap variants *before* recommending one. Each variant names the trade-off it accepts.
3. **Interview** — one question at a time on architecture / data-model / UX. Multiple-choice when 2–4 options are genuinely live. Reference-pointing beats 200 words of explanation.
4. **Validate** — incremental check-in: "does this match what you wanted?" before going deeper.
5. **Hand off** — once design is approved, switch to `planning-and-task-breakdown` (or `incremental-implementation` for trivial slices).

## Cheat Sheet

| Situation | Default action |
|---|---|
| Spec concrete, single-file | Skip brainstorm, implement. |
| Spec concrete, multi-file or design-heavy | One question on the riskiest unknown, then plan. |
| Spec vague | Variants first, then interview. |
| "Sanity check" / "prototype" | Use `prototype` skill, not this one. |
| Multiple valid approaches | Show 2–4 variants with trade-offs. |
| New library / framework | Point at official docs/source. |

## Red Flags

Skipping variants for a design decision; asking 5 questions in one message (overwhelming); "we can add caching later" hand-waving in a production-bound design; starting code/plan before user approval; "YAGNI" used to dismiss the user's stated requirement (use it against speculative creep, not stated requirements).

## Anti-Patterns

**The 200-word answer** when 2–4 variants would surface the same trade-off; **the leading question** ("Should we use X, which is obvious?") collapses the brainstorm; **the silent assumption** picks a stack/pattern without naming it; **premature implementation** drafts a plan before the user approves the design.

## Skill Result Contract

```xml
<skill_result>
  <skill>brainstorming</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Unknowns mapped, variants shown (if novel), design approved by user</evidence>
  <artifacts>Design summary or "skipped — spec was concrete"</artifacts>
  <risks>Unresolved questions, scope creep, premature commitment, or none</risks>
</skill_result>
```
