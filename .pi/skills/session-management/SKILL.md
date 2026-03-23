---
name: session-management
description: Use when context is growing large, switching tasks, or needing previous session context - covers thresholds, session tools, and workflow patterns
version: 1.0.0
tags: [context, workflow]
dependencies: []
---

# Session Management

## When to Use

- Managing context growth, switching tasks, or resuming past sessions.

## When NOT to Use

- Single, short tasks that don't require session transitions.

## Context Thresholds

The environment monitors context usage and warns at these thresholds:

| Threshold | Action                                                     |
| --------- | ---------------------------------------------------------- |
| **70%**   | Consolidate work; consider pruning irrelevant tool outputs |
| **85%**   | Summarize findings and consider starting a new session     |
| **95%**   | Critical: prune context immediately or restart session     |

## Session Context Recovery

### Search Previous Sessions

Search and discover previous sessions by keyword to recover context.

```
Search previous sessions for: "auth bug"        (limit 5 results)
Search previous sessions for: "refactor"         (default limit)
```

**Tips:**

- Use multi-word queries for AND matching
- Returns ranked results with snippets and suggested next steps

### Read a Previous Session

Read messages from a specific previous session. Supports optional focus filtering.

```
Read previous session: ses_abc123                 (full session)
Read previous session: ses_abc123 (focus: "auth") (filter to relevant messages)
```

**Tips:**

- Use the session ID returned from searching previous sessions
- Focus keyword filters messages to what's relevant

## When to Start New Session

- Completing distinct task from `br ready`
- Token usage approaching 500k (or 150k for 200k context models)
- Switching phases (implementation → review → testing)
- After handoff (`/handoff <bead-id>`)

## Session Workflow Pattern

```
Session 1: Implement feature X (200k tokens)
  ↓ close, update memory
Session 2: Search previous sessions for "feature X" → read session → Refactor (150k tokens)
  ↓
Session 3: Search previous sessions for "feature X" → Add tests (200k tokens)
  ↓
Session 4: Read previous session → Final review (250k tokens)
```

**Result**: 4 fresh contexts vs 1 degraded 800k context. Better performance, lower cost.

## Context Transfer

Use all available sources:

1. Search + read previous sessions — Previous session work
2. Git state — `git diff`, `git log` — Code changes
3. Memory files — `docs/*` — Persistent context
4. Beads — `br show <id>` — Task specs

**Don't**: Carry everything forward. Extract what's needed, discard the rest.

## Pruning Strategy

When context grows large:

1. **Discard** completed task outputs (read files you won't edit again)
2. **Extract** key findings before discarding research
3. **Summarize** complex investigations into memory files
4. **Restart** session if above 85% and work is at a natural break

## Anti-Patterns

- ❌ Running until context limit forces restart
- ❌ Carrying all previous reads forward "just in case"
- ❌ Not using memory files for cross-session persistence
- ❌ Re-reading the same files every session instead of extracting key info
