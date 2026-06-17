# Memory Extension

Minimal FTS5-backed memory for Pi. After ADR-001 cleanup: 8,170 → 2,313 lines (72% reduction),
zero ML deps, agent-driven compaction. Per the Syntax #976 thesis: "Bash is all you need" and
"the agent itself has some autonomy over how it compresses it."

## Tool Surface (3 tools, matches Pi's "while loop with N tools")

| Tool | Purpose |
|------|---------|
| `observation` | Store a manual observation (decision, bugfix, pattern, feature, discovery, learning, warning) |
| `memory-search` | FTS5 BM25 search of observations; or read/list stored markdown files |
| `memory-admin` | Status, export, import, maintenance, compact, rebuild |

## Slash Commands

- `/memory-compact [sinceDays]` — Agent-driven lossy compression. Reads recent observations,
  writes a markdown payload to `.pi/artifacts/notes/{ISO-week}.md`. The agent then
  edits that file to keep the high-signal summaries. Opt-in, never automatic.

## Path Conventions

| What | Where | Why |
|------|-------|-----|
| Observations (DB) | `~/.config/pi/memory/memory.db` | Per-user, cross-project |
| Compaction notes | `<project>/.pi/artifacts/notes/{ISO-week}.md` | Per-project, gitignored |
| Schema migrations | Inside `migrations.ts` | Forward-only, v7 is the cleanup |

## Architecture

```
memory.ts              → Entry point: tool registration + before_agent_start injection + /memory-compact
memory/
  tools.ts             → registerMemoryTools: 3-tool surface
  observations.ts      → FTS5 search + CRUD
  scoring.ts           → recordFeedback(obsId, "helpful"|"harmful")
  distill.ts           → getObservationsForCompaction / writeCompactionNote
  admin.ts             → memory-admin operation dispatch
  maintenance.ts       → archiveOldObservations, runFullMaintenance
  migrations.ts        → v1 base + v6→v7 cleanup
  config.ts            → types + MEMORY_CONFIG
  db.ts                → SQLite (FTS5 only, allowExtension: false)
  helpers.ts           → small utilities
  sanitize.ts          → PII redaction
  storage.ts           → markdown file storage in DB
  curator.ts           → (deprecated stub, kept for source enum)
  index-generator.ts   → memory index generator
```

## Bash is all you need

The DB is plain SQLite at `~/.config/pi/memory/memory.db`. Inspect it directly:

```bash
# Type breakdown
sqlite3 ~/.config/pi/memory/memory.db "SELECT type, COUNT(*) FROM observations WHERE superseded_by IS NULL GROUP BY type;"

# Recent observations
sqlite3 ~/.config/pi/memory/memory.db "SELECT id, type, title FROM observations WHERE superseded_by IS NULL ORDER BY created_at_epoch DESC LIMIT 10;"

# Most-retrieved (proxy for usefulness)
sqlite3 ~/.config/pi/memory/memory.db "SELECT id, title, retrieval_count, last_retrieved FROM observations WHERE retrieval_count > 0 ORDER BY retrieval_count DESC LIMIT 10;"

# Helpful vs harmful ratio
sqlite3 ~/.config/pi/memory/memory.db "SELECT SUM(helpful_count) AS helpful, SUM(harmful_count) AS harmful FROM observations;"

# Recent feedback events
sqlite3 ~/.config/pi/memory/memory.db "SELECT * FROM feedback_events ORDER BY id DESC LIMIT 10;"
```

## Design Decisions (per ADR-001)

| Decision | Rationale |
|----------|-----------|
| FTS5 only, no vector embeddings | Armin: "I guarantee you [embeddings] do not produce better outputs." |
| No 4-state maturity machine | Ran on feedback we never collected (0 events) |
| No auto-distill, no auto-dream | "System underneath you shifts" anti-pattern |
| No persona auto-generation | Mario: unhealthy emotional binding |
| No project index FTS5 | Armin: "list of folders and short descriptions. Easy to maintain by the clanker itself." |
| Agent-driven compaction | Mario: "agent itself has some autonomy over how it compresses it" |
| Compaction notes in `.pi/artifacts/notes/` | Per-project (this project's observations), not per-user |
| `allowExtension: false` in SQLite | Locked down, no extensions loaded |

## Open Questions (post-merge)

- Add `PROJECT.md` single-file repo map (per Armin's recommendation) — separate ADR
- Add explicit weekly cron for `/memory-compact` (currently opt-in only) — design with user
- Run 1-week A/B test (with-memory vs. without-memory) per Armin's challenge
