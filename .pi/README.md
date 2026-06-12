# pikit — Pi Agent Extension

Auto-triggered features that enhance the Pi coding agent with memory consolidation, project indexing, and checkpoint recovery.

## Features

### Auto-Dream (memory consolidation)
- **Trigger**: `agent_end` event (after each agent turn)
- **What**: Extracts key terms from recent session messages using TF-IDF, detects bug reports/architecture decisions/feature requests via keyword patterns, and creates durable observations.
- **Config**: `.pi/extensions/memory/config.ts` — `MEMORY_CONFIG.dream`

### Auto-Distill (tool pattern → skill generation)
- **Trigger**: `session_before_compact` event
- **What**: Mines tool call sequences across sessions, detects repeated patterns (e.g., "grep → read → edit"), and generates candidate skill files in `.pi/agent/skills/auto-distilled/`.
- **Requirements**: At least 2 sessions with 3+ tool calls sharing the same tool sequence.
- **Throttle**: Runs at most once per 30 days per session.

### FTS5 Project Index
- **Trigger**: `session_start` event (background, non-blocking)
- **What**: Indexes `.md`, `.ts`, `.tsx`, `.js`, `.json`, `.yaml`, `.toml` files from the project root into a SQLite FTS5 virtual table.
- **Effect**: `memory-search` tool searches both observations and project file contents.
- **Limit**: Max 200 indexed files.

### Checkpoint Writer
- **Trigger**: `turn_end`, `session_before_compact`, `tool_result` (for edit/write/bash tools)
- **What**: Writes session state snapshots to `.pi/checkpoints/<sessionId>/`. On session rebuild (e.g., after restart), injects checkpoint context into the system prompt.
- **Retention**: Configurable max per session (FIFO eviction).
- **Rebuild context**: Injected via `before_agent_start` event as a `<system-reminder>` block (respects configurable character budget).

### Tool-Result Pruning (DCP)
- **Trigger**: During DCP compression (`session_before_compact`)
- **What**: Filters verbose tool results (grep, find, list) to keep only compactable output.
- **Config**: `.pi/extensions/dcp/config.ts` — `DCP_CONFIG.pruning`

## Directory Structure

```
.pi/
  checkpoints/            → Session state snapshots (auto-generated, gitignored)
  extensions/
    memory/               → Memory system (dream, distill, project-index)
    checkpoint/           → Checkpoint writer
    dcp/                  → DCP compression (tool-result pruning)
```

## Caveats

- Dream consolidations are keyword-based, not AI-generated.
- Project index uses `readdirSync` on first run (may cause brief startup lag on large projects).
