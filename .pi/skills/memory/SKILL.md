---
name: memory
description: ALWAYS read durable project context from `.pi/MEMORY.md`; append learnings to it. File-based, on-demand, observable.
---

# Memory

Durable project knowledge lives in `<cwd>/.pi/MEMORY.md`. Read it on demand when relevant, append to it when new learnings surface.

## When to load

**ALWAYS** at the start of any task that:

- involves a decision, design choice, or architectural call
- references prior work, past sessions, or "what we did before"
- is in a project the user has memory for (`<cwd>/.pi/MEMORY.md` exists)
- the user mentions "memory", "before", "last time", "we used to", or similar

For trivial edits, single-line fixes, or pure code questions with no project context — skip.

## Where memory lives

- `<cwd>/.pi/MEMORY.md` — project-specific memory (per working directory)
- `~/.pi/MEMORY.md` — global personal memory (cross-project, cross-session)

The user creates and owns these files. They are not part of this skill.

Sections in MEMORY.md: architecture, decisions, patterns, gotchas. Grep-friendly keywords.

## Usage

**Recall prior context:**

```bash
# Search memory
rg -n "<topic>" <cwd>/.pi/MEMORY.md

# Or read the whole file (when small)
read <cwd>/.pi/MEMORY.md
```

**Save a new learning this session:**

1. Check for duplicates: `rg -n "<topic>" <cwd>/.pi/MEMORY.md`
2. If the learning is durable, append a bullet via `edit`. Keep entries short.

**Compact when the file grows:**

- Read the file, then rewrite, dropping low-signal entries.
- Target: under 5KB. If it grows past that, compact.

## Conventions for entries

- One bullet per learning, with type tag in brackets: `[decision]`, `[bugfix]`, `[pattern]`, `[feature]`, `[discovery]`, `[learning]`, `[warning]`.
- Prefer concise titles; narrative only when essential.

## Anti-rationalization

| Shortcut the model reaches for | Why it fails here |
|---|---|
| "I'll remember it" | You won't, across compaction + sessions; MEMORY.md is durable because memory isn't. |
| "I'll write it later" | "Later" after compaction is gone; append the learning now, while it's observed. |
| "The context already has it" | Context compacts; MEMORY.md survives. If it mattered once, it matters to record. |

## When NOT to use

- For session-internal scratch work — use the conversation, not MEMORY.md.
- For ephemeral task tracking — use `TODO.md`, not MEMORY.md.
- For project rules — those go in `AGENTS.md`, not MEMORY.md.