---
name: memory
description: Persistent learnings, prior decisions, and project context. ALWAYS check this skill at the start of any task to recall prior context, established patterns, and historical decisions before responding. The user's memory file is loaded on-demand via `read`.
---

# Memory

Persistent context that survives across sessions. The user maintains a memory file; you read it when relevant and edit it when new durable learnings come up.

## When to load

**ALWAYS** at the start of any task that:
- involves a decision, design choice, or architectural call (a prior decision may exist)
- references prior work, past sessions, or "what we did before"
- is in a project the user has memory for (`<cwd>/.pi/MEMORY.md` exists)
- the user mentions "memory", "before", "last time", "we used to", or similar

For trivial edits, single-line fixes, or pure code questions with no project context — skip.

## Where memory lives

- `~/.pi/MEMORY.md` — global personal memory (cross-project, cross-session)
- `<cwd>/.pi/MEMORY.md` — project-specific memory (per working directory)

The user creates and owns these files. They are not part of this skill.

## Usage

**Recall prior context:**

```bash
# Read the whole file (when small)
read ~/.pi/MEMORY.md

# Or search for a specific topic
grep -i "topic" ~/.pi/MEMORY.md
```

**Save a new learning this session:**

1. Read the current memory file to check for duplicates.
2. If the learning is durable, append a bullet via `edit`. Keep entries short.

**Compact when the file grows:**

- Read the file, then rewrite, dropping low-signal entries.
- Target: under 5KB. If it grows past that, compact.

## Conventions for entries

- One bullet per learning, with type tag in brackets: `[decision]`, `[bugfix]`, `[pattern]`, `[feature]`, `[discovery]`, `[learning]`, `[warning]`.
- Optional metadata: `helpful=N` / `harmful=N` if the user has rated entries.
- Prefer concise titles; narrative only when essential.

## When NOT to use this skill

- For session-internal scratch work — use the conversation context, not MEMORY.md.
- For ephemeral task tracking — use a TODO.md file, not MEMORY.md.
- For project rules — those go in AGENTS.md, not MEMORY.md.

## Recovery (advanced)

If the user maintains an archive of dropped entries, recover via `grep` on the archive path. Most users do not need an archive — compact, don't accumulate.
