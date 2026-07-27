---
name: doubt-driven-development
description: Runs a fresh-context adversarial review attacking the strongest version of a plan or claim. Use before writing code for a non-trivial design or fix, or before declaring work done.
---

# Doubt-driven development

Confidence is the default failure mode. Before a non-trivial decision stands — an architecture choice, a fix approach, a "this is done" claim — run it through fresh-context doubt. The goal is not to validate the plan but to break it, then keep only what survives.

## When to load

- Before writing code for a non-trivial design or fix.
- Before declaring work complete on anything ≥ 2 files or a behavior change.
- When a plan feels obviously right — that is exactly when to doubt it.

## When NOT to load

- Mechanical, single-path changes with an obvious answer.
- After a change is already reviewed (use `code-review-and-quality` instead).
- Interactive refinement with the user (use `grill-me` instead).

## The workflow

1. **State the strongest version of the plan/claim.** Steel-man it before attacking — a weak attack on a weak plan proves nothing.
2. **Spawn a fresh-context adversary.** Delegate via `task(reviewer)` or `task(general)` with ONLY the plan and a mandate to find how it breaks — no prior context, no buy-in. Independent `task` calls go in one message; the adversary must not share the parent's confirmation bias.
3. **Hunt the failure modes confidence hides:**
   - What assumption, if wrong, sinks this?
   - Where does the plan conflate "works in the happy path" with "works"?
   - What evidence would change the decision — and is it present?
   - What is the second-order effect nobody has named?
4. **Grade the doubt.** For each attack: `survives` / `forces change` / `kills the plan`. Keep claims only where evidence backs them.
5. **Decide and record.** Keep the plan, revise it, or abandon it. Record the decision + the doubt that shaped it in `.pi/artifacts/DECISIONS.md` (rationale required).

## Anti-rationalization

| Shortcut | Why it fails |
|----------|--------------|
| "I already know this is right" | That is the signal to run doubt, not skip it. Confidence is the failure mode this skill exists for. |
| "The plan is simple, nothing to doubt" | Simple plans hide assumptions in what they don't say. Name the assumptions (step 3). |
| "I'll doubt it after I build it" | Doubt after building is review, not doubt. The cheapest fix is the one you never write. |
| "I reviewed it myself" | Self-review is confirmation bias with extra steps. The adversary must be fresh-context and independent (step 2). |

## Output

A doubt report: the steel-manned plan, the attacks with verdicts, the surviving decision + rationale, and what evidence would still change it.