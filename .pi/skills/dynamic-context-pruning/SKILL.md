# Dynamic Context Pruning (DCP v2)

> Runtime-enforced context management for Pi coding agents. Prune + compress conversation to stay in budget.

## Overview

DCP v2 operates at **two levels**:

1. **Runtime enforcement** — The extension hooks into Pi's `context`, `turn_end`, `session_before_compact`, and `before_agent_start` events to automatically prune, nudge, and compact.
2. **Agent behavior** — The `compress` tool remains available for manual crystallization of completed phases.

**Key change from v1**: Strategies (dedup, supersede-writes, purge-errors) now execute automatically via the `context` event before every LLM call. They are no longer just behavioral guidance.

## What Happens Automatically (No Agent Action Needed)

| Feature | Hook | What It Does |
|---|---|---|
| **Deduplication** | `context` | Same tool + same args called twice → older result content stripped |
| **Supersede-writes** | `context` | File written then later read → write input stripped |
| **Purge-errors** | `context` | Errored tool inputs stripped after 4+ turns |
| **Nudge injection** | `before_agent_start` | Context usage warnings injected as messages |
| **Auto-compact** | `turn_end` | `ctx.compact()` triggered at 80% context usage |
| **Status display** | `turn_end` | Footer shows current context usage |
| **Fact extraction** | `session_compact` | Durable facts extracted from compaction summaries |

## What the Agent Should Still Do

### Use `compress` for Phase Boundaries

When a phase of work is complete (research, implementation, debugging), use `compress`:

```
compress({
  topic: "Auth System Research",
  startId: "beginning of auth discussion",
  endId: "auth approach decided",
  summary: "Exhaustive summary of the phase..."
})
```

**Rules**:
- Summary must be EXHAUSTIVE — it replaces the original conversation
- Never run multiple compress calls in parallel
- Only compress closed phases where you won't need raw context

### Use `ctx_expand` for Reversible Compression

If you need details from a compressed block:

```
ctx_expand({ blockId: 3 })  // Expands block b3 back to raw transcript
```

Capped at ~15k tokens per expansion.

## Dual-Band Token Budget

| Phase | Threshold | Behavior |
|---|---|---|
| **Free** | < 50k tokens | No pressure, no nudges |
| **Nudge** | 50k–150k | Gentle reminders to compress completed phases |
| **Critical** | > 150k | Strong nudges, prepare for compaction |
| **Auto-compact** | > 80% of context | `ctx.compact()` triggered automatically |

## Deferred Drop Queue

Inspired by Magic Context's cache-aware design:
- When strategies identify droppable content, drops are **queued** (not applied immediately)
- Drops execute when provider cache TTL expires (default 5min) or context hits 65%
- This avoids paying twice for the same tokens due to KV cache invalidation

## Fact Extraction

After compaction, DCP extracts durable facts into categories:
- ARCHITECTURE_DECISIONS, CONSTRAINTS, NAMING_CONVENTIONS
- KNOWN_ISSUES, WORKFLOW_RULES, DEPENDENCIES
- FILE_PATTERNS, API_CONTRACTS

Facts with retrieval_count ≥ 3 are candidates for promotion to permanent memory.

## Commands

- `/dcp` — Full status: context usage, auto-prune stats, tags, queue, facts, blocks
