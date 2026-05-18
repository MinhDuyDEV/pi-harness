# Pipeline Architecture: Chunked Parallel Translation

This document explains the pikit-translate pipeline architecture, which is the reference pattern for any pikit skill that processes long content.

## Design Rationale

### The Problem

Long documents (4000+ words) push against LLM context limits and produce lower-quality output in a single pass:
- Terminology drifts across the document
- The model loses track of earlier content
- Consistent tone/style is hard to maintain
- If any step fails, the whole output is lost

### The Solution: Chunked Parallel Processing

Split content at semantic boundaries (markdown blocks, not arbitrary line splits), translate each chunk in a parallel subagent, then merge. Each subagent receives shared context so terminology and tone remain consistent.

```
                    ┌─────────────────────────────┐
                    │   Main Agent: Analysis       │
                    │   01-analysis.md             │
                    │   02-prompt.md (shared ctx)  │
                    └──────────┬──────────────────┘
                               │
                               ▼
                    ┌─────────────────────────────┐
                    │   Chunk: markdown block      │
                    │   boundaries                 │
                    └──────────┬──────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
    ┌─────────────────┐ ┌─────────────┐ ┌─────────────┐
    │ Subagent:        │ │ Subagent:   │ │ Subagent:   │
    │ chunk-01         │ │ chunk-02    │ │ chunk-NN    │
    │ reads 02-prompt  │ │ reads same  │ │ reads same  │
    │ → chunk-01-draft │ │ → draft     │ │ → draft     │
    └────────┬─────────┘ └──────┬──────┘ └──────┬──────┘
             └──────────────────┼────────────────┘
                                ▼
                    ┌─────────────────────────────┐
                    │   Main Agent: Merge + QA     │
                    │   03-draft.md (merged)       │
                    │   04-critique.md             │
                    │   05-revision.md             │
                    │   translation.md (final)     │
                    └─────────────────────────────┘
```

## Key Design Decisions

### 1. Shared Context via File, Not Inline Args

Subagents read `02-prompt.md` — a file with shared context. This is more token-efficient than passing context in task descriptions, avoids duplication across N subagents, and lets you regenerate prompts without re-spawning agents.

### 2. Semantic Chunking

Chunks split at markdown block boundaries (headings, paragraphs, code blocks), not arbitrary line counts. This preserves structural context within each chunk. Handled by `scripts/main.ts`.

### 3. Main Agent Owns Quality

Subagents only produce the initial draft. The main agent handles:
- Analysis (understanding the full document)
- Shared prompt assembly
- Post-merge critique (cross-chunk consistency)
- Revision and polish

This prevents the "subagent drift" problem where parallel agents go in different stylistic directions.

### 4. Intermediate Artifacts at Every Step

Every stage writes a file. This means:
- The pipeline is inspectable and debuggable
- You can resume from any failed step
- Different agents can work on different steps
- The process is transparent to the user

### 5. Idempotent Chunk Script

`scripts/main.ts` only handles chunking — it reads source, splits at block boundaries, writes chunk files. Pure function: same input always produces same chunks. This lets you re-chunk without side effects.

## Comparison of Approaches

| Approach | Consistency | Token Cost | Resume | Parallel Speed |
|----------|------------|------------|--------|----------------|
| Single pass | Medium | Low | Lost | N/A |
| Sequential chunks | High | Medium | Partial | Slow |
| **Parallel chunks (this)** | High (shared context) | Medium (shared once) | Full | Fast |

## Generalizing the Pattern

This architecture applies to any skill that processes long content:

| Skill | Chunk Unit | Shared Context | Subagent Task |
|-------|-----------|----------------|---------------|
| Translate | Markdown blocks | Style + glossary + analysis | Translate chunk |
| Summarize | Sections | Target format + length | Summarize chunk |
| Refactor | Functions/files | Coding style + patterns | Refactor chunk |
| Rewrite | Paragraphs | Tone + audience | Rewrite chunk |
| Diagram | System components | Layout rules + style | Component sub-diagram |
