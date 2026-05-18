---
name: memory-system
description: Use when persisting learnings, loading previous context, or searching past decisions - covers memory file structure, tools, and when to update each file
version: 1.2.0
tags: [context, workflow]
dependencies: []
agent_types: [planner, worker, reviewer]
tools: []
---

# Memory System Best Practices

> **Replaces** losing context between sessions — persistent knowledge that survives session boundaries

## When to Use

- Starting work and needing prior decisions, bugfixes, or patterns
- Recording non-obvious decisions/learnings for future sessions
- Creating handoffs so the next session can continue quickly

## When NOT to Use

- Ephemeral debugging notes that won't matter after the current task
- Storing generated artifacts/log dumps as long-term memory

## Core Principle

**Progressive disclosure**: search compactly, fetch fully only when relevant, then record high-signal observations.

## Session Workflow

1. **Ground (search first)**
   - Run `memory-search` with task keywords before implementation.
   - Check recent handoffs when resuming interrupted work.
2. **Calibrate (progressive disclosure)**
   - Use search results as index.
   - Fetch full entries only for relevant IDs (`memory-search` (exact #id)).
   - Pull timeline context only when sequencing matters (`memory-search` (time-ordered)).
3. **Record (high-signal only)**
   - Create `observation` for decisions, bugfixes, patterns, warnings, or durable learnings.
   - Include searchable concepts and concrete file references.
4. **Handoff (if session boundary)**
   - Write a concise status note with completed work, blockers, and next steps using memory-admin write-file under `handoffs/`.

## What Goes Where

| Store | Put Here | Avoid Here |
| --- | --- | --- |
| `observation` (SQLite) | Events: decisions, bugfixes, reusable patterns, warnings | Temporary notes, speculative ideas without evidence |
| `memory-admin write-file` files | Durable docs: handoffs, research, project notes | Every minor runtime detail from a single debug run |
| Auto pipeline | Captured messages + distillations (automatic) | Manual copying of full transcripts |

## Observation Quality Bar

Use this checklist before creating an observation:

- Is it likely useful in a future session?
- Is it non-obvious (not already in code/comments)?
- Can I summarize it in one clear title + short narrative?
- Did I include strong search terms in `concepts` and relevant files?

If most answers are "no", skip creating the observation.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Instead |
| --- | --- | --- |
| Storing transient debugging info as permanent observations | Pollutes search results with low-value noise | Keep transient info in session context; record only durable findings |
| Creating observations for every small finding (signal-to-noise) | Important items get buried and retrieval quality drops | Batch minor notes; publish one distilled observation per meaningful outcome |
| Not searching memory before creating duplicate observations | Produces conflicting/duplicated records | Run `memory-search` first; update/supersede existing records when appropriate |
| Using `memory-admin write-file` for data that should be an observation | Durable events become hard to discover and rank | Use `observation` for events; reserve `memory-admin write-file` for document-style files |

## Verification

After creating an observation: `memory-search` with relevant keywords should find it.

## Practical Defaults

- Prefer specific queries over broad ones (`"auth race condition init"` > `"auth"`).
- For ongoing work, append to one handoff file per task/day instead of many tiny files.
- Keep observation titles concrete and action-oriented.

## Admin Operations

The `memory-admin` tool supports these operations:

### Core (existing)
| Operation | Purpose |
|---|---|
| `status` | Storage stats, FTS5 health, pipeline counts |
| `full` | Full maintenance cycle (archive + checkpoint + vacuum) |
| `archive` | Archive observations older than N days |
| `checkpoint` | Checkpoint WAL file |
| `vacuum` | Vacuum database |
| `migrate` | Import .pi/memory/observations/*.md into SQLite |
| `capture-stats` | Temporal message capture statistics |
| `distill-now` | Force distillation for current session |
| `curate-now` | Force curator run |

### Knowledge Intelligence (new in v2.1)
| Operation | Purpose |
|---|---|
| `lint` | Find duplicates, contradictions, stale/orphan observations |
| `index` | Generate a structured catalog of all observations |
| `compile` | Build concept-grouped articles from observation clusters |
| `log` | View the append-only operation audit trail |

Examples:
```
memory-admin({ operation: "lint" })
memory-admin({ operation: "lint", older_than_days: 60 })
memory-admin({ operation: "index" })
memory-admin({ operation: "compile" })
memory-admin({ operation: "log" })
```

### Reading Compiled Artifacts
```
memory-read({ file: "index" })             // Full observation catalog
memory-read({ file: "compiled/auth" })      // Compiled article for "auth" concept
memory-read({ file: "log" })                // Operation audit trail
```

## Validation Gate

The `observation` tool now validates before storing:
- **Exact duplicate** → rejected (returns duplicate ID + supersede hint)
- **Near-duplicate** → stored with warning
- **Contradiction** → stored with warning (for decisions sharing concepts)
- **Low quality** → stored with warning (no narrative + no concepts)

To update an existing observation, use `supersedes`:
```
observation({ type: "decision", title: "Use JWT", supersedes: "42", ... })
```

## Idle Pipeline

During `session.idle`, the memory system automatically runs:
1. Distill undistilled messages
2. Curate observations from distillations
3. Optimize FTS5 index
4. Checkpoint WAL if large
5. Compile concept articles (max 10)
6. Regenerate memory index

## See Also

- `context-management`
- `session-management`


## Consolidated Reflection And Grounding

This is the canonical active skill for durable learnings. Former memory-grounding and sprint-retro/reflection responsibilities are archived as redundant. Persist decisions, bug patterns, project conventions, and useful warnings when they are likely to help future sessions.
