---
name: grill-me
description: Adversarial interrogation of ideas before implementation — pushes on ambiguity, hidden assumptions, missing constraints, and hand-waving. Use when you have a rough idea, ADR, PRD, or spec that needs to survive scrutiny before code is written.
version: 1.0.0
tags: [planning, review, decision]
dependencies: [brainstorming, spec-driven-development]
agent_types: [planner, worker, reviewer]
tools: []
---

# Grill Me — Adversarial Idea Interrogation

> **Replaces** skipping straight from idea to implementation without pressure-testing the plan.
> **Sits between** `brainstorming` (collaborative refinement) and `spec-driven-development` (formal spec/ADR creation).

## When to Use

- You have a rough idea that needs to be tested before implementation
- You just finished brainstorming and need to find the flaws
- You have an existing ADR, PRD, or spec that needs to be stress-tested
- The agent (me) seems unclear about what to build and you want to surface that confusion

## When NOT to Use

- Requirements are already well-understood and the task is mechanical
- You are already in implementation with a validated plan
- The task is trivial (< 1 file, no decisions needed)
- You need creative exploration (use `brainstorming` instead)

## How This Is Different From Brainstorming

| Brainstorming | Grill Me |
|---|---|
| Collaborative exploration | Adversarial interrogation |
| "What do we need to build?" | "Why is this idea wrong or incomplete?" |
| Generates options and approaches | Destroys weak options |
| Asks clarifying questions | Asks challenging, uncomfortable questions |
| Refines the idea | Tests if the idea survives scrutiny |
| Output: a better design | Output: resolved uncertainties, killed bad ideas, hardened decisions |

## Process

### Phase 1: Surface the Idea

Read the available context — the user's prompt, any existing docs, the repo structure, relevant code. Identify exactly what is being proposed. Restate it clearly so the human can correct any misunderstanding.

### Phase 2: Interrogate

Go after the idea systematically. Do not be polite. Do not assume the idea is sound. Push on:

**Ambiguity**
- Which terms in this description could mean different things to different people?
- What's the actual scope boundary — what's explicitly in, what's explicitly out?
- Can you point to a concrete example of the expected behavior?

**Hidden assumptions**
- What does this idea assume about the existing system?
- What does it assume about user behavior, data quality, or failure modes?
- What does it assume about team capacity, deployment timeline, or external dependencies?
- What does it assume the human reviewer will accept without question?

**Missing constraints**
- What constraints are implicit but never stated?
- Performance? Security? Backward compatibility? Error handling? Observability?
- What existing patterns in the codebase constrain this design?
- What deadlines or external commitments constrain the approach?

**Hand-waving**
- Where does the idea say "we'll figure that out later"?
- Where are the "obviously" or "simply" or "just" statements? Those are hiding complexity.
- What's the hardest part of this idea, and how does the current plan address it?
- What would have to go wrong for this idea to fail, and how would we know?

**Integration & blast radius**
- What existing code would this touch?
- What would break if this change were deployed?
- What tests would need to change?
- What documentation would become outdated?

### Phase 3: Resolve

For each question raised in Phase 2:

1. Present the question to the human with a concrete example
2. Let the human answer or make a decision
3. Record the resolution
4. Update any existing documents (ADR, PRD, spec) with the new information

If the human cannot answer a question, flag it as a blocker — do not proceed to implementation until it's resolved.

### Phase 4: Assess

After all questions have been addressed:

- **Is the idea clearly defined enough to proceed?** YES → recommend writing it up as an ADR or spec via `documentation-and-adrs` or `spec-driven-development`.
- **Is the idea fundamentally flawed?** YES → say so directly. Explain why and suggest alternatives.
- **Are there too many unresolved questions?** YES → recommend another brainstorming round or more research before committing to implementation.

### Phase 5 (optional): Grill-with-Docs

If you're working with an existing ADR, PRD, or spec document:

1. Read the document(s) thoroughly
2. Apply the same interrogation against the document content
3. For each gap found, propose edits to the document
4. Present the proposed edits to the human for approval
5. Apply approved edits

## Success Criteria

The grilling is complete when:
- Questions start repeating (you've exhausted the line of inquiry)
- Added precision stops changing the plan (diminishing returns)
- Every ambiguity, assumption, constraint gap, and hand-wave has been surfaced and either resolved or flagged as a blocker
- You can state clearly: "this idea is ready for an ADR/spec" or "this idea should be killed/reworked"

## Output

Leave behind a clear summary of:
- What was challenged and resolved
- What decisions were made
- What remains blocked or unresolved
- Recommended next step (ADR, spec, more research, kill the idea)

This summary becomes the input for the next phase (ADR writing or spec-driven-development).

## Anti-Patterns

- **Being too nice.** This is not a collaborative exploration — this is an adversarial review. If you're not making the human think hard, you're doing it wrong.
- **Grilling during implementation.** Do this BEFORE any code is written. Once files change, the cost of finding a flaw is much higher.
- **Grilling trivial tasks.** A one-line bugfix doesn't need this. Use judgment.
- **Accepting "we'll fix it later."** If something is identified as risky, it needs a decision now or a clear blocker flag.
- **Grilling without context.** Read the repo, understand the existing patterns, and ground your questions in actual code.

## See Also

- `brainstorming` — collaborative exploration (use before grilling)
- `spec-driven-development` — formal spec writing (use after grilling)
- `documentation-and-adrs` — recording decisions in ADR format
- `development-lifecycle` — full phased workflow
