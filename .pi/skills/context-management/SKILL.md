---
name: context-management
description: Use when context is growing large, needing to compress tool outputs, or managing conversation size - covers DCP tools, strategies, and context budgets
version: 2.0.0
tags: [context, workflow]
dependencies: []
---

# Context Management

## When to Use

- Context is growing large and you need to compress tool outputs
- You are finishing a phase and want to preserve signal while freeing tokens

## When NOT to Use

- You still need active file contents for upcoming edits
- The output is protected or required for immediate modifications

## Tool Hierarchy (v3.0+ Philosophy)

Everything flows through the single `compress` tool. Compress > Distill > Prune are
**behavioral intent tiers**, not separate tools.

| Intent       | Use When                                               | Implementation        |
| ------------ | ------------------------------------------------------ | --------------------- |
| **Compress** | A phase of work is complete — collapse the whole phase | `compress` tool       |
| **Distill**  | Large raw output with extractable value to preserve    | `compress` (detailed) |
| **Prune**    | Pure noise: wrong target, irrelevant, zero value       | `compress` (minimal)  |

**Why compress-first:** Granular tool-level pruning triggers cache invalidation on every provider,
especially Anthropic. Compressing whole phases instead of surgically deleting individual outputs
is cheaper, faster, and more reliable.

**Never prune because it's convenient. Only prune true noise.**

## Available Tools

| Tool         | Purpose                                 | When to Use                         |
| ------------ | --------------------------------------- | ----------------------------------- |
| `compress`   | Collapse conversation range into summary| Phase complete, research done       |

Use `/dcp` command for stats and to review active compression blocks.

## Phase-Boundary Compress Triggers

The most effective compress timing is at natural phase endings. For the Compound Engineering loop:

| Phase ends            | What to compress                         | Keep                              |
| --------------------- | ---------------------------------------- | --------------------------------- |
| `/plan` research done | Exploration turns, scout/explore outputs | Plan.md facts, key decisions      |
| `/ship` wave complete | Implementation turns, read file outputs  | Commit refs, verification results |
| `/review` complete    | Raw agent outputs (all 5 reviewers)      | Synthesized findings summary      |
| `/compound` done      | Entire compound loop session             | Observation titles stored         |
| Session → handoff     | Everything since last compress           | Handoff doc summary               |

**Rule:** Every completed phase is a compress candidate. Don't wait until context is full — compress as chapters close.

## DCP Auto-Strategies

DCP runs these automatically at zero LLM cost — don't manually manage these:

- **Deduplication** — removes duplicate tool calls (same tool + same args)
- **Supersede Writes** — removes write inputs when file is later read
- **Purge Errors** — removes errored tool inputs after 4 turns

## When to Evaluate

**DO evaluate at:**

- Start of new turn after receiving user message (best timing — you know what's needed next)
- Phase boundary: research done, implementation wave done, review done
- Large tool output just returned that won't be needed for upcoming edits
- Information superseded by newer, more specific output

**DO NOT manage when:**

- Output needed for upcoming file edits (read files stay until edit is done)
- Contains active file contents you're about to modify
- Uncertain if you'll need it — defer until certain
- DCP auto-strategies already handle it

## Protected Content

Auto-protected from pruning:

- `write` and `edit` tool outputs
- `.env*` files
- `AGENTS.md`
- `.pi/**` config
- `.beads/**` tasks
- `package.json`, `tsconfig.json`

Don't manually protect what's already protected.

## Self-Monitoring Nudges

| Context Level      | Action                                                                     |
| ------------------ | -------------------------------------------------------------------------- |
| Below 100k tokens  | No compression pressure — work freely                                      |
| 100k–300k tokens   | Light reminders at turn boundaries — check for compressible ranges         |
| 300k–500k tokens   | **Moderate** — compress completed phases proactively                       |
| Above 500k tokens  | **Critical** — compress now, prioritize one large closed range first       |
| 15+ iterations     | After 15 messages without user input, check for closed compressible ranges |

## Context Budget Guidelines

| Phase             | Target    | Action                                            |
| ----------------- | --------- | ------------------------------------------------- |
| Starting work     | <100k     | Load only essential AGENTS.md + task spec         |
| Mid-task          | 100–300k  | Compress completed phases, keep active files      |
| Steady work       | 300–500k  | Compress aggressively by phase                    |
| Approaching limit | 500k–800k | Critical — compress all closed ranges, minimize   |
| Near capacity     | >800k     | Session restart with handoff                      |

At >500k: prefer compressing full phases over individual outputs. The cache cost is lower.

## XML Tag Suppression

DCP uses internal XML metadata tags for prompt injection. **Never output these tags in
user-visible responses.** Act on them but do not echo them.

## Quick Reference

```
HIERARCHY: compress > distill > prune (behavioral tiers via single compress tool)
TIMING: manage at turn START, not turn END
PHASE ENDS = compress trigger
XML TAGS: never echo DCP-internal XML tags in output

TOOLS: compress (crystallize)
EXTENSION: .pi/extensions/dcp.ts → SQLite at ~/.config/pi/dcp/dcp.db

BUDGET (1M): <100k start → 100-300k compress phases → 300-500k moderate → >500k critical → >800k restart
```
