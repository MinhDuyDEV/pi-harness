---
name: memory-system
description: Use when persisting learnings, loading previous context, or searching past decisions - covers memory file structure, tools, and when to update each file
version: 1.0.0
tags: [context, workflow]
dependencies: []
---

# Memory System Best Practices

## When to Use

- Starting work and needing to recall prior decisions, bugs, or patterns
- Recording non-obvious learnings or decisions for future sessions

## When NOT to Use

- For ephemeral notes that won't matter beyond the current session
- When you need to change actual markdown files (use read/write), not SQLite memory entries


## Architecture

```
message.part.updated → capture.ts → temporal_messages
                                        ↓ (session.idle, 10+ messages)
                                     distill.ts → distillations (TF-IDF + key sentences)
                                        ↓ (session.idle)
                                     curator.ts → observations (pattern-matched)
                                        ↓
system.transform ← inject.ts ← FTS5 search → scored + packed → system prompt
messages.transform ← context.ts → token budget enforcement
```

### 4 Tiers

| Tier              | Storage       | Populated By        | Purpose                         |
| ----------------- | ------------- | ------------------- | ------------------------------- |
| temporal_messages | SQLite        | Automatic (capture) | Raw message text, 180-day TTL   |
| distillations     | SQLite + FTS5 | Automatic (idle)    | TF-IDF compressed sessions      |
| observations      | SQLite + FTS5 | Manual + curator    | Decisions, bugs, patterns, etc. |
| memory_files      | SQLite        | Manual              | Static docs, handoffs, research |

## Core Principle

**Progressive disclosure** — search compactly, fetch fully, timeline chronologically. Never load all memory at once.

---

## The Ritual

Follow this every session. Memory is not optional — it's how knowledge compounds.

### 1. Ground — Search Before You Start

Always search memory first.

```typescript
// Search for relevant past work
memory - search({ query: "<task keywords>", limit: 5 });
memory - search({ query: "bugfix <component>", type: "observations" });

// Check recent handoffs
memory - search({ query: "handoff", type: "handoffs", limit: 3 });
```

**Why:** Past you already solved this. Don't rediscover.

### 2. Calibrate — Progressive Disclosure

Don't fetch full content until you know you need it.

```typescript
// 1. Search returns compact index (50-100 tokens per result)
const results = memory - search({ query: "auth patterns" });
// Returns: [{id: 42, title: "Auth bug fixed", ...}]

// 2. Fetch full details ONLY for relevant IDs
memory - get({ ids: "42,45" });

// 3. See what led to this decision
memory - timeline({ anchor_id: 42, depth_before: 3 });
```

**Why:** Prevents context bloat. High signal, low noise.

### 3. Transform — Record Discoveries

Create observations for anything non-obvious. Don't wait until the end.

```typescript
observation({
  type: "pattern", // decision | bugfix | pattern | discovery | warning | learning
  title: "Brief description",
  narrative: "Context and reasoning...",
  facts: "key, facts, here",
  concepts: "searchable, keywords",
  files_modified: "src/file.ts",
  source: "manual", // manual (default) | curator | imported
});
```

| Type        | Use When                   | Example                            |
| ----------- | -------------------------- | ---------------------------------- |
| `decision`  | Architectural choice made  | "Use zod over yup"                 |
| `bugfix`    | Root cause found & fixed   | "Race condition in async init"     |
| `pattern`   | Reusable code pattern      | "Repository with error boundaries" |
| `discovery` | New capability learned     | "Bun.test supports mocking"        |
| `warning`   | Dangerous pattern to avoid | "Don't use fs.watch in Docker"     |
| `learning`  | General insight            | "Always validate at boundary"      |

### 4. Reset — Handoff for Next Session

Document completion state for future you.

```typescript
memory -
  update({
    file: "handoffs/YYYY-MM-DD-task",
    content: `## Completed
- X

## Blockers
- Y

## Next
- Z`,
    mode: "append",
  });
```

---

## Memory Tools Reference

### memory-search (Start Here)

Fast FTS5 full-text search with porter stemming. Returns **compact index** for progressive disclosure.

```typescript
memory - search({ query: "authentication" });
memory - search({ query: "bugfix", type: "observations", limit: 5 });
memory - search({ query: "session", type: "handoffs" });
memory - search({ query: "patterns", type: "all" }); // Search everything
```

**Search modes:**

- `observations` (default): Search SQLite with FTS5 BM25 ranking
- `handoffs`, `research`, `templates`: Search specific directories
- `beads`: Search .beads/artifacts
- `all`: Search everything

### memory-get (Progressive Disclosure)

Fetch full observation details after identifying relevant IDs:

```typescript
memory - get({ ids: "42" }); // Single observation
memory - get({ ids: "1,5,10" }); // Multiple observations
```

### memory-timeline (Chronological Context)

See what happened before/after a specific observation:

```typescript
memory - timeline({ anchor_id: 42, depth_before: 5, depth_after: 5 });
```

### memory-read (Files)

Load project files, handoffs, or templates:

```typescript
memory - read({ file: "project/gotchas" });
memory - read({ file: "handoffs/2024-01-20-phase-1" });
memory - read({ file: "research/auth-patterns" });
```

### memory-update (Files)

Save to project files or handoffs:

```typescript
memory -
  update({
    file: "project/gotchas",
    content: "### New Gotcha\n\nDescription...",
    mode: "append", // or "replace"
  });
```

### memory-admin (Maintenance)

```typescript
// Check current status (schema, FTS5, counts, DB size)
memory - admin({ operation: "status" });

// Full maintenance (archive >90 days, checkpoint WAL, vacuum)
memory - admin({ operation: "full" });

// Preview what would be archived
memory - admin({ operation: "archive", older_than_days: 60, dry_run: true });

// Capture pipeline stats (temporal messages, distillations, compression)
memory - admin({ operation: "capture-stats" });

// Force distillation for current session
memory - admin({ operation: "distill-now" });

// Force curator run (extract observations from distillations)
memory - admin({ operation: "curate-now" });
```

**Automatic:** On session idle — distillation, curation, FTS5 optimize, WAL checkpoint.

**Manual:** Run `memory-admin({ operation: "status" })` to check health.

---

## What Goes Where

### SQLite (observations)

- Events: decisions, bugfixes, patterns discovered
- Searchable via FTS5 with porter stemming
- Created manually via `observation()` or automatically by curator
- Use `observation()` to create

### SQLite (distillations — automatic)

- Compressed session summaries with TF-IDF terms
- Created automatically when 10+ messages accumulate
- Searchable via FTS5
- Used for relevance-scored LTM injection

### Markdown Files

- Static knowledge: user preferences, tech stack
- Handoffs: session summaries
- Research: deep-dive documents
- Use `memory-read()` / `memory-update()`

| Location                   | Content                    | Tool                                |
| -------------------------- | -------------------------- | ----------------------------------- |
| `project/user.md`          | User identity, preferences | `memory-read()`                     |
| `project/tech-stack.md`    | Frameworks, constraints    | `memory-read()`                     |
| `project/gotchas.md`       | Footguns, warnings         | `memory-update({ mode: "append" })` |
| `handoffs/YYYY-MM-DD-*.md` | Session summaries          | `memory-update()`                   |
| `research/*.md`            | Deep-dive analysis         | `memory-update()`                   |
| SQLite observations        | Events, decisions          | `observation()`                     |
| SQLite distillations       | Session summaries          | Automatic (idle) or `distill-now`   |
| SQLite temporal_messages   | Raw captured text          | Automatic (message events)          |

---

## Observations Schema

```typescript
observation({
  type: "decision", // decision, bugfix, pattern, discovery, warning, learning
  title: "Use JWT auth",
  narrative: "Decided to use JWT because it's stateless...",
  facts: "stateless, scalable, industry standard",
  concepts: "auth, jwt, security",
  confidence: "high", // high, medium, low
  files_read: "src/auth.ts, src/middleware.ts",
  files_modified: "src/auth.ts",
  bead_id: "br-abc123", // Link to task (optional)
  source: "manual", // manual (default), curator, imported
});
```

---

## Anti-Patterns (Don't Do This)

| ❌ Don't                            | ✅ Do Instead                          |
| ----------------------------------- | -------------------------------------- |
| Load full memory at session start   | Use progressive disclosure             |
| Create observations for everything  | Only non-obvious decisions             |
| Duplicate in files AND observations | Files = static, SQLite = events        |
| Vague search queries                | Use specific keywords, file paths      |
| Subagents writing to memory         | Only leader agents create observations |
| Wait until end to record            | Create observations as you discover    |

---

## Philosophy

**Memory is not a dumping ground. It's curated signal.**

- Search before you build
- Record what you learned
- Hand off to future you

> "The body is architecture. The breath is wiring. The rhythm is survival."

Memory is rhythm — it carries knowledge across the silence between sessions.
