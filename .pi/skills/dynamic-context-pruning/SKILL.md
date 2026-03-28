# Dynamic Context Pruning (DCP v2.1)

> Runtime-enforced context management for Pi coding agents. Prune + compress conversation to stay in budget.

## Overview

DCP v2.1 operates at **two levels**:

1. **Runtime enforcement** — The extension hooks into Pi's `context`, `turn_end`, `session_before_compact`, and `before_agent_start` events to automatically prune, nudge, and compact.
2. **Agent behavior** — The `compress` tool remains available for manual crystallization of completed phases.

**Key change from v1**: Strategies (dedup, supersede-writes, purge-errors) now execute automatically via the `context` event before every LLM call. They are no longer just behavioral guidance.

**v2.1 additions** (from v3.1.4 research):
- **Summary buffer** — Compressed block tokens extend effective nudge thresholds (prevents nudge storms)
- **Priority map** — Nudges include biggest compression targets by name (e.g., "read 5x, ~25k tokens")
- **Message-mode compression** — `compress` in message mode includes priority suggestions
- **Nested block overlap** — Old compressed summaries are embedded when new compression overlaps
- **Hardened nudge format** — Clear prefixes with actionable compression targets

## What Happens Automatically (No Agent Action Needed)

| Feature | Hook | What It Does |
|---|---|---|
| **Deduplication** | `context` | Same tool + same args called twice → older result content stripped |
| **Supersede-writes** | `context` | File written then later read → write input stripped |
| **Purge-errors** | `context` | Errored tool inputs stripped after 4+ turns |
| **Compress-strip** | `context` | Compressed ranges removed, summary injected (with nested overlap) |
| **Priority map** | `context` | Tool results classified by token size for nudge targeting |
| **Nudge injection** | `before_agent_start` | Context usage warnings with priority targets injected as messages |
| **Summary buffer** | `turn_end` | Summary tokens extend effective max (prevents premature nudges) |
| **Status display** | `turn_end` | Footer shows current context usage + summary buffer |
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
- **Nested overlap**: If your range overlaps a previous compressed block, the old summary is automatically embedded — information is never lost through compression layers

### Message-Mode Compression

Use `mode: "message"` for surgical single-message compression:

```
compress({
  topic: "Large research output",
  startId: "research phase",
  endId: "research complete",
  summary: "...",
  mode: "message"
})
```

In message mode, the tool output includes **priority suggestions** showing which tool results consume the most tokens — helping you target the biggest wins next.

### Use `ctx_expand` for Reversible Compression

If you need details from a compressed block:

```
ctx_expand({ blockId: 3 })  // Expands block b3 back to raw transcript
```

Capped at ~15k tokens per expansion.

## Dual-Band Token Budget (with Summary Buffer)

| Phase | Threshold | Behavior |
|---|---|---|
| **Free** | < 50k tokens | No pressure, no nudges |
| **Nudge** | 50k–effectiveMax | Gentle reminders with priority targets |
| **Critical** | > effectiveMax | Strong nudges with compression targets |
| **Auto-compact** | > 80% of context | Critical nudge (Pi's native compaction handles it) |

**effectiveMax** = `maxContextLimit` + min(activeSummaryTokens, `summaryBuffer`)

Example: With 150k max limit and 12k in summary blocks → effectiveMax = 162k

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

- `/dcp` — Full status: context usage, effective max, priority map, auto-prune stats, tags, queue, facts, blocks
