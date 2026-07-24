---
name: brainstorming
description: Use when creating or developing, before writing code or implementation plans - refines rough ideas into fully-formed
  designs through collaborative questioning, alternative exploration, and incremental validation. Don't use during clear 'mechanical'
  processes
metadata:
  version: 1.1.0
  tags:
  - planning
  - workflow
  dependencies: []
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

1. **Map unknowns** — classify the gap using the four categories above. State assumptions out loud for ambiguous cases. If the request is well-defined, do not brainstorm — just fix. For unfamiliar domains or high-stakes decisions, include:

   ```md
   ### Highest-risk blindspots
   1. <unknown>
      - Why it matters:
      - Evidence:
      - Cheap resolution:
      - Decision owner: user | agent | docs | prototype

   ### Safe assumptions
   - <assumption> — why safe; how to verify later
   ```

   Rank blindspots by implementation risk. Do not manufacture evidence; mark inaccessible evidence as unverified.
2. **Variants** — for novel / design-heavy / unclear work, show 2–4 cheap variants *before* recommending one. Each variant names the trade-off it accepts.
3. **Interview** — one question at a time on architecture / data-model / UX. Multiple-choice when 2–4 options are genuinely live. Reference-pointing beats 200 words of explanation.
4. **Validate** — incremental check-in: "does this match what you wanted?" before going deeper.
5. **Hand off** — once design is approved, switch to `planning-and-task-breakdown` (or `incremental-implementation` for trivial slices).

## Compact decision guide

- Concrete single-file request: skip brainstorming and implement.
- Vague or design-heavy request: surface the riskiest unknown, then show variants.
- New library/framework: point to official source before committing.

Avoid five questions at once, silent assumptions, premature plans, and using YAGNI to dismiss a stated requirement. Prefer a short evidence-backed question over a long speculative answer.

## Anti-rationalization

| Shortcut the model reaches for | Why it fails here |
|---|---|
| "I have the idea, let me build it" | An idea ≠ a design; pressure-test it before code locks the wrong shape. |
| "The first approach is fine" | The first approach is the obvious one; the skill explores alternatives because obvious is usually shallow. |
| "Questioning will slow us down" | Questioning now is faster than rebuilding after the wrong design ships. |

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
