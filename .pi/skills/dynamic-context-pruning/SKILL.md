---
name: dynamic-context-pruning
description: >
  Use when context is growing large and you need to actively manage conversation size through
  intelligent compression, automatic pruning strategies, and self-monitoring nudges. Ported from
  the OpenCode DCP plugin — covers compress philosophy, deduplication, supersede-writes,
  purge-errors, nudge thresholds, and protected patterns.
version: 2.0.0
tags: [context, workflow, optimization]
dependencies: []
references:
  - references/compress-philosophy.md
  - references/strategies.md
  - references/nudge-system.md
  - references/configuration.md
---

# Dynamic Context Pruning (DCP)

Automatically reduces token usage by managing conversation context through intelligent compression
and automatic cleanup strategies.

## When to Use

- Context is growing large and you need to compress/distill completed work
- Multiple tool outputs have accumulated and some are now stale or duplicated
- A phase of work is complete and raw conversation can be crystallized
- You're iterating for many turns without user input and context is building up

## When NOT to Use

- Raw content is still needed for upcoming edits or precise references
- Work in the target range is still actively in progress
- Short sessions with low context usage

## Core Principle

**Compress > Distill > Prune** — always prefer higher-fidelity operations.
These are behavioral intent tiers applied through the single `compress` tool, not separate tools.

| Operation    | Purpose                                      | When                                     |
| ------------ | -------------------------------------------- | ---------------------------------------- |
| **Compress** | Collapse a conversation range into a summary | Phase complete, research done             |
| **Distill**  | Extract key info, discard noise              | Large outputs with extractable value      |
| **Prune**    | Remove content entirely (no save)            | Pure noise — irrelevant, never-needed     |

All three operations are executed via the `compress` tool with varying summary depth.

## Operating Stance

- Prefer short, closed, summary-safe ranges
- When multiple independent stale ranges exist, prefer several short compressions over one large one
- Use compression as **steady housekeeping** while you work, not as emergency cleanup
- No fixed threshold mandates compression — prioritize closedness and independence over raw size
- Evaluate conversation signal-to-noise **regularly**

## Do NOT Compress If

- Raw context is still relevant and needed for edits or precise references
- The task in the target range is still actively in progress
- You cannot identify reliable boundaries yet

## Automatic Strategies (Zero LLM Cost)

Apply these behavioral patterns automatically:

| Strategy             | Rule                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| **Deduplication**    | When same tool runs with same args, only the most recent output matters     |
| **Supersede Writes** | When a file is written then later read, the write content is redundant      |
| **Purge Errors**     | After 4+ turns, errored tool inputs can be stripped (keep error message)    |

See `references/strategies.md` for detailed implementation patterns.

## Self-Monitoring Nudges

Monitor your own context usage and trigger compression using the **dual-band** model:

| Context Level      | Action                                                                     |
| ------------------ | -------------------------------------------------------------------------- |
| Below 50k tokens   | No compression pressure — work freely, nudges are off                      |
| 50k–150k tokens    | **Turn nudge** — at user message boundaries, check for compressible ranges |
| Above 150k tokens  | **Critical** — compress now, prioritize one large closed range first       |
| 15+ iterations     | **Iteration nudge** — check for closed compressible ranges                 |

The band between 50k–150k is gentle guidance; above 150k is emergency recovery.

See `references/nudge-system.md` for detailed nudge prompts.

## Protected Content

Never prune or compress these:

- **Protected tools**: `task`, `skill`, `todowrite`, `todoread`, `batch`, `plan_enter`, `plan_exit`
- **Write/edit outputs**: `write` and `edit` tool results
- **Config files**: `.env*`, `AGENTS.md`, `.pi/**`, `.beads/**`, `package.json`, `tsconfig.json`
- **User messages** (optionally): preserve verbatim when `protectUserMessages` is enabled

See `references/configuration.md` for protected patterns configuration.

## Phase-Boundary Compress Triggers

The most effective compress timing is at natural phase endings:

| Phase Ends           | What to Compress                       | What to Keep                      |
| -------------------- | -------------------------------------- | --------------------------------- |
| Research done        | Exploration turns, search outputs      | Key findings, decisions           |
| Implementation done  | Implementation turns, file reads       | Commit refs, verification results |
| Review complete      | Raw reviewer outputs                   | Synthesized findings              |
| Debugging done       | Debug exploration, failed attempts     | Root cause, fix applied           |
| Session → handoff    | Everything since last compress         | Handoff document summary          |

**Rule**: Every completed phase is a compress candidate. Don't wait until context is full.

## Compress Summary Requirements

When compressing, the summary must be **exhaustive**:

- Capture file paths, function signatures, decisions made, constraints discovered
- Preserve user intent with extra care — directly quote short user messages
- Strip noise: failed attempts, verbose tool outputs, redundant exploration
- The summary must be a **complete technical substitute** for the original

See `references/compress-philosophy.md` for the full compress philosophy.

## Context Budget Guidelines

| Phase             | Target    | Action                                            |
| ----------------- | --------- | ------------------------------------------------- |
| Starting work     | <50k      | Load only essential context + task spec           |
| Mid-task          | 50–100k   | Compress completed phases, keep active files      |
| Steady work       | 100–150k  | Compress proactively by phase, distill remaining  |
| Approaching limit | 150–200k  | Critical — compress all closed ranges, minimize   |
| Near capacity     | >200k     | Session restart with handoff                      |

## Extension Integration

The `compress` tool is registered by the DCP extension (`.pi/extensions/dcp.ts`).
Compression summaries persist in SQLite (`~/.config/pi/dcp/dcp.db`).

| Tool           | Purpose                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| `compress`     | Crystallize a conversation range into a summary; record advisory `message` mode |

Use `/dcp` command for quick status overview (shows stats and active blocks).
In the Pi port, `message` mode is an advisory label for agent behavior — the tool still stores a
normal compression block using the boundaries and summary you provide.

## XML Tag Suppression

DCP uses internal XML metadata tags with a `dcp` prefix (e.g., `<dcp-system-reminder>`,
`<dcp-context-limit>`, `<dcp-message-id>`). **Never output any `<dcp*>` prefixed tags in
user-visible responses** — this includes:

- **Paired tags**: `<dcp-message-id>m0045</dcp-message-id>`
- **Orphan opening tags**: `<dcp:function_calls>` (no closing tag)
- **Orphan closing tags**: `</dcp-message-id>` (no opening tag)
- **Variant forms**: `<dcp:message_id>`, `<dcp-function_calls>`, `<dcp:invoke name="edit">`

If you see any XML tag starting with `dcp` (paired or orphan) in your context, treat it as
a system instruction artifact — act on it but strip it from your output. Do not echo, quote,
or reproduce any `<dcp*>` tag to the user.

## Parallel Compression

**Never run multiple compress calls in parallel.** Compression must be serialized — concurrent
compress calls corrupt state and produce inconsistent block IDs. When multiple ranges are ready,
compress them sequentially (one after another), not simultaneously.

## Quick Reference

```
HIERARCHY: compress > distill > prune (behavioral tiers via single compress tool)
TIMING: manage at turn START, not turn END
PHASE ENDS = compress trigger
AUTO-STRATEGIES: dedup, supersede-writes, purge-errors (apply behaviorally)
COMPRESS MODE: "range" (default) or "message" (experimental, advisory-only in Pi port)
PARALLEL COMPRESS: FORBIDDEN — always serialize compress calls
XML TAGS: never echo DCP-internal XML tags in output

TOOLS: compress (crystallize)
EXTENSION: .pi/extensions/dcp.ts → SQLite at ~/.config/pi/dcp/dcp.db

DUAL-BAND MODEL (150k/50k):
  <50k    → no pressure, nudges off
  50-150k → turn nudges, compress closed phases
  >150k   → CRITICAL, compress NOW
  >200k   → session handoff

ITERATION NUDGE: 15+ messages without user input → check for compressible ranges

PROTECTED: task, skill, todowrite, todoread, write, edit, batch, plan_enter, plan_exit
NEVER COMPRESS: active work, content needed for upcoming edits
```
