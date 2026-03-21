---
name: dynamic-context-pruning
description: >
  Use when context is growing large and you need to actively manage conversation size through
  intelligent compression, automatic pruning strategies, and self-monitoring nudges. Ported from
  the OpenCode DCP plugin — covers compress philosophy, deduplication, supersede-writes,
  purge-errors, nudge thresholds, and protected patterns.
version: 1.0.0
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

Monitor your own context usage and trigger compression based on these thresholds:

| Context Level     | Action                                                                     |
| ----------------- | -------------------------------------------------------------------------- |
| Below 50k tokens  | No compression pressure — work freely                                      |
| 50k–150k tokens   | Light reminders at turn boundaries — check for compressible ranges         |
| Above 150k tokens | **Critical** — compress now, prioritize one large closed range first       |
| 15+ iterations    | After 15 messages without user input, check for closed compressible ranges |

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

| Phase             | Target  | Action                                            |
| ----------------- | ------- | ------------------------------------------------- |
| Starting work     | <50k    | Load only essential context + task spec           |
| Mid-task          | 50–100k | Compress completed phases, keep active files      |
| Approaching limit | >100k   | Compress aggressively by phase, distill remaining |
| Near capacity     | >150k   | Session restart with handoff                      |

## Extension Integration

The `compress`, `dcp-stats`, and `decompress` tools are registered by the DCP extension
(`.pi/extensions/dcp.ts`). Compression summaries persist in SQLite (`~/.config/pi/dcp/dcp.db`).

| Tool           | Purpose                                           |
| -------------- | ------------------------------------------------- |
| `compress`     | Crystallize a conversation range into a summary   |
| `dcp-stats`    | Show compression statistics (session or global)   |
| `decompress`   | Review stored compression blocks                  |

Use `/dcp` command for quick status overview.

## XML Tag Suppression

DCP uses internal XML metadata tags (e.g., `<dcp-system-reminder>`, `<dcp-context-limit>`)
for prompt injection. **Never output these tags in user-visible responses.** If you see
DCP-internal XML tags in your context, treat them as system instructions — act on them
but do not echo them to the user.

## Quick Reference

```
HIERARCHY: compress > distill > prune (behavioral tiers via single compress tool)
TIMING: manage at turn START, not turn END
PHASE ENDS = compress trigger
AUTO-STRATEGIES: dedup, supersede-writes, purge-errors (apply behaviorally)
XML TAGS: never echo DCP-internal XML tags in output

TOOLS: compress (crystallize), dcp-stats (monitor), decompress (review)
EXTENSION: .pi/extensions/dcp.ts → SQLite at ~/.config/pi/dcp/dcp.db

BUDGET:
  <50k  → no pressure
  50-150k → light nudges, compress closed phases
  >150k → critical, compress NOW
  >200k → session handoff

PROTECTED: task, skill, todowrite, todoread, write, edit, batch, plan_enter, plan_exit
NEVER COMPRESS: active work, content needed for upcoming edits
```
