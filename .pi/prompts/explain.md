---
description: Explain code, architecture, or concepts
argument-hint: "<file, function, concept, or question>"
---

# Explain: $ARGUMENTS

Provide a clear, concise explanation of the requested code or concept.

## Process

### Phase 1: Locate

- Find the relevant code/files
- Read the implementation and surrounding context
- Trace key dependencies and callers

### Phase 2: Explain

Structure the explanation as:

1. **What it does** — one-sentence summary
2. **How it works** — step-by-step walkthrough with file:line references
3. **Why** — design rationale, trade-offs, alternatives considered
4. **Key relationships** — what depends on this, what this depends on
5. **Gotchas** — edge cases, non-obvious behavior, known issues

## Rules

- Cite specific file:line references for every claim
- Use code snippets to illustrate key points
- Keep it concise — explain the "why" more than the "what"
- If the code is complex, break into layers (high-level → detail)
- Don't make changes — this is read-only exploration
