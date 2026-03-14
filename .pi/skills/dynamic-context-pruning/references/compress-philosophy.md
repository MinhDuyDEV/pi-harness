# Compress Philosophy

Ported from the OpenCode DCP plugin's compress tool description. This is the detailed philosophy
that guides how compression should be performed.

## What Compress Is

`compress` transforms verbose conversation sequences into dense, high-fidelity summaries. This is
not cleanup — it is **crystallization**. Your summary becomes the authoritative record of what
transpired.

Think of compression as phase transitions: raw exploration becomes refined understanding. The
original context served its purpose; your summary now carries that understanding forward.

## The Summary

Your summary must be **EXHAUSTIVE**. Capture:

- File paths and function signatures
- Decisions made and why
- Constraints discovered
- Key findings and patterns
- Types, interfaces, and data structures
- Error patterns and their resolutions

This is not a brief note — it is an authoritative record so faithful that the original conversation
adds zero value.

Yet be **LEAN**. Strip away:

- Failed attempts that led nowhere
- Verbose tool outputs already captured in summary
- Back-and-forth exploration noise
- Redundant confirmations

What remains should be pure signal — golden nuggets of detail that preserve full understanding
with zero ambiguity.

## User Intent Fidelity

When the compressed range includes user messages, preserve the user's intent with extra care:

- Do not change scope, constraints, priorities, acceptance criteria, or requested outcomes
- Directly quote user messages when they are short enough to include safely
- Direct quotes are preferred when they best preserve exact meaning

## When to Compress

Compress when a range is genuinely closed and the raw conversation has served its purpose:

- Research concluded and findings are clear
- Implementation finished and verified
- Exploration exhausted and patterns understood
- Debugging complete and fix applied

Compress smaller ranges when:

- You need to discard dead-end noise without waiting for a whole chapter to close
- You need to preserve key findings from a narrow slice while freeing context quickly

## When NOT to Compress

- You may need exact code, error messages, or file contents in the immediate next steps
- Work in that area is still active or likely to resume immediately
- You cannot identify reliable boundaries yet

**Before compressing, ask**: _"Is this range closed enough to become summary-only right now?"_
Compression is irreversible. The summary replaces everything in the range.

## Operating Stance

- Prefer short, closed, summary-safe ranges
- When multiple independent stale ranges exist, prefer several short compressions over one
  large-range compression
- Use compress as steady housekeeping while you work
- Prioritize closedness and independence over raw range size
- Prefer smaller, regular compressions over infrequent massive compressions for better quality

## Parallel Compression

When multiple independent ranges are ready and their boundaries do not overlap, compress
multiple ranges in the same pass. This is the **preferred pattern** over a single large-range
compression when the work can be safely split.

Run compression sequentially only when ranges overlap or when a later range depends on the
result of an earlier compression.

## Summary Template

```markdown
## [Phase/Topic] Summary

### Context
[What was being done and why]

### Key Findings
- [Finding 1 with file paths and specifics]
- [Finding 2 with exact signatures/types]

### Decisions Made
- [Decision with rationale]

### Artifacts
- [Files created/modified: path → description]

### Remaining
- [What's left undone, if anything]
```

## Quality Checklist

Before finalizing a compression summary:

- [ ] All file paths mentioned are exact
- [ ] Function signatures include parameter types and return types
- [ ] Decisions include rationale, not just the choice
- [ ] User intent is preserved faithfully (quoted when short)
- [ ] No active work content is being compressed
- [ ] Summary is self-sufficient — original conversation adds no value
