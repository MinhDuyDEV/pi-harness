# Compress Philosophy (v2)

> Compress transforms verbose conversation into dense, high-fidelity summaries.
> This is not cleanup — it is crystallization.

## The Summary Contract

Your summary must be **EXHAUSTIVE**:
- File paths and function signatures
- Decisions made and their rationale
- Constraints discovered
- Key findings and evidence
- User intent (quote short user messages directly)

Yet be **LEAN**:
- Strip failed attempts
- Strip verbose tool outputs
- Strip redundant back-and-forth exploration

**Test**: If someone reads only the summary, they should be able to continue the work without missing anything.

## When to Compress

- Research concluded and findings are clear
- Implementation finished and verified
- Exploration exhausted and patterns understood
- Debugging complete and fix applied
- A phase naturally closed

## When NOT to Compress

- You may need exact code, error messages, or file contents in the immediate next steps
- Work in that area is still active or likely to resume immediately
- Cannot identify reliable boundaries

## v2: Cache-Aware Deferred Drops

In v2, compression benefits from the deferred drop queue:
- When you compress, the original content is queued for removal (not immediately stripped)
- The queue waits for the provider's KV cache to expire (default 5 minutes)
- This means your next LLM call still benefits from cached context
- Drops execute automatically when the cache expires or context gets full

## v2: Reversible Compression

Before compaction, raw transcripts are stored in SQLite.
If you later need details the summary doesn't cover:

```
ctx_expand({ blockId: 3 })  // Decompresses block b3
```

This is an escape hatch — the agent isn't locked into summaries forever.

## Serialization Rules

- Never run multiple compress calls in parallel
- Always ask: "Is this range closed enough to become summary-only right now?"
- Include enough context for a fresh agent to understand the work
