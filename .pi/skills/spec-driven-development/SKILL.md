---
name: spec-driven-development
description: Turns ambiguous requirements into a locked spec — goal, non-goals, user stories, acceptance criteria. Use when starting a feature, when a request is "add X" with no details, or when work spans sessions.
metadata:
  version: 1.0.0
  tags:
  - workflow
  - planning
  - product
  dependencies: []
---

# Spec-Driven Development

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Spec before code.** A 200-word spec prevents a 2000-line rewrite.
- **The spec is the contract.** Implementation matches the spec, not "what I imagined".
- **Spec gaps surface in the interview.** Can't write the spec = don't know what you're building.
- **Spec changes are explicit.** Change in spec = change in scope. Note it.
- **Tests derive from the spec.** Requirement without a test isn't a requirement.
</EXTREMELY-IMPORTANT>

## When to Use

New feature with ambiguous requirements; "let's add X" without details; "I want a thing that does Y"; significant change; multi-file or multi-session work; the team disagrees on what to build.

## When NOT to Use

Trivial change; one-line fix; bug fix with known root cause; well-understood domain.

## Spec Anatomy

```markdown
# Feature: [Name]

## Goal
[1-2 sentences. What user-visible behavior?]

## Non-goals
[What's explicitly out of scope.]

## User stories
- As a [role], I want [action], so that [outcome].

## Acceptance criteria
- [ ] [Observable behavior 1]
- [ ] [Observable behavior 2]

## Open questions
- [Question that must resolve before implementation]
```

Goal + non-goals + acceptance criteria = the minimum spec.

## Workflow

1. **Capture the request.** What's the user-observable change?
2. **Draft the spec.** Goal, non-goals, stories, criteria. May take 30-60 min.
3. **Interview the gap.** What's underspecified? Ask one question at a time.
4. **Lock the spec.** User approves.
5. **Implementation derives from the spec.** Each acceptance criterion → one or more tests.
6. **Spec changes are tracked.** A spec change is a commit message line, not a verbal "btw".

## Spec vs Plan

- **Spec** = WHAT (what we're building, what behavior)
- **Plan** = HOW (how we'll build it, in what order, with what risks)

`spec-driven-development` is for WHAT. `planning-and-task-breakdown` is for HOW. Spec first, then plan.

## Red Flags

Spec written after code; no goal, no non-goals (scope creep), or no acceptance criteria (can't test); "make it good" (not specific); spec as a wishlist; spec so detailed it IS the code (just write the code); no open questions listed; scope changed verbally instead of in the versioned spec file; spec vs code drift; "I'll know it when I see it" (not a spec).

## Anti-rationalization

| Shortcut the model reaches for | Why it fails here |
|---|---|
| "I understand the feature, I'll build it" | Understanding ≠ specified; ambiguity in your head becomes wrong code. Write the spec first. |
| "I'll refine the spec as I code" | Refining-while-coding is coding without a spec; the spec locks before code so changes are visible. |
| "Non-goals can wait" | Non-goals defined late = invisible scope creep; list them now or the feature grows. |
