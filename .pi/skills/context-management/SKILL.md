---
name: context-management
description: Use when context is growing large, needing to prune/distill tool outputs, or managing conversation size - covers DCP slash commands and context budgets
version: 1.0.0
tags: [context, workflow]
dependencies: []
---

# Context Management

## When to Use

- Context is growing large and you need to compress/distill/prune tool outputs
- You are finishing a phase and want to preserve signal while freeing tokens

## When NOT to Use

- You still need active file contents for upcoming edits
- The output is protected or required for immediate modifications


## Tool Hierarchy (v2.2+ Philosophy)

DCP beta shifted to a compress-first approach. Follow this order strictly:

```
compress > distill > prune
```

| Tool       | Use When                                               | Cache Impact |
| ---------- | ------------------------------------------------------ | ------------ |
| `compress` | A phase of work is complete — collapse the whole phase | Minimal      |
| `distill`  | Large raw output with extractable value to preserve    | Low          |
| `prune`    | Pure noise: wrong target, irrelevant, zero value       | Moderate     |

**Why this matters:** Granular `prune` calls trigger cache invalidation on every provider, especially Anthropic. Compressing whole phases instead of surgically deleting individual outputs is cheaper, faster, and more reliable.

**Never prune because it's convenient. Only prune true noise.**

## DCP Slash Commands (Recommended)

| Command                 | Purpose                                  | When to Use                         |
| ----------------------- | ---------------------------------------- | ----------------------------------- |
| `/dcp compress [focus]` | Collapse conversation range into summary | Phase complete, research done       |
| `/dcp distill [focus]`  | Distill key findings before removing     | Large outputs with valuable details |
| `/dcp sweep [count]`    | Prune all tools since last user message  | Cleanup pure noise only             |
| `/dcp context`          | Show token breakdown by category         | Check context usage                 |
| `/dcp stats`            | Show cumulative pruning stats            | Review efficiency                   |

## Tool Calls (Fallback)

Use when slash commands aren't suitable:

| Tool       | Purpose                       | When to Use                           |
| ---------- | ----------------------------- | ------------------------------------- |
| `compress` | Collapse conversation range   | Phase complete, research done         |
| `distill`  | Extract key info, then remove | Large outputs with valuable details   |
| `prune`    | Remove tool outputs (no save) | Noise only — irrelevant, never-needed |

**Note:** Prefer `/dcp compress` slash command over the `compress` tool — better boundary matching.

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

Auto-protected from pruning (v2.1.7+):

- `write` and `edit` tool outputs
- `.env*` files
- `AGENTS.md`
- `.pi/**` config
- `.beads/**` tasks
- `package.json`, `tsconfig.json`

Don't manually protect what's already protected.

## Distill — Preserve + Remove

Extract high-fidelity knowledge from tool outputs, then remove the raw output. Distillation must be a **complete technical substitute** — capture signatures, types, logic, constraints, everything essential.

```typescript
distill({
  targets: [
    {
      id: "10",
      distillation:
        "auth.ts: validateToken(token: string) -> User|null, uses bcrypt 12 rounds, throws on expired tokens",
    },
    {
      id: "11",
      distillation:
        "user.ts: interface User { id: string, email: string, permissions: Permission[], status: 'active'|'suspended' }",
    },
  ],
});
```

## Context Budget Guidelines

| Phase             | Target  | Action                                            |
| ----------------- | ------- | ------------------------------------------------- |
| Starting work     | <50k    | Load only essential AGENTS.md + task spec         |
| Mid-task          | 50-100k | Compress completed phases, keep active files      |
| Approaching limit | >100k   | Compress aggressively by phase, distill remaining |
| Near capacity     | >150k   | Session restart with handoff                      |

At >100k: prefer compressing full phases over distilling individual outputs. The cache cost is lower.

## Quick Reference

```
HIERARCHY: compress > distill > prune
TIMING: manage at turn START, not turn END
PHASE ENDS = compress trigger

DCP SLASH COMMANDS (preferred):
/dcp compress [focus]  → Collapse completed phase
/dcp distill [focus]   → Distill key findings
/dcp sweep [count]     → Prune pure noise only
/dcp context           → Show token breakdown

TOOL CALLS (fallback):
compress({ topic, content: { startId, endId, summary } })
distill({ targets: [{ id, distillation }] })
prune({ ids: [...] })  ← last resort only

BUDGET: <50k start → 50-100k compress phases → >100k aggressive → >150k restart
```
