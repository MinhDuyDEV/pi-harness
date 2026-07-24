---
name: obsidian
description: Use when working with Obsidian vault via MCP - read/write notes, search, tag management, and vault operations
metadata:
  version: 1.0.0
  tags:
  - integration
  - documentation
  dependencies: []
disable-model-invocation: true
---

# Obsidian (MCP)

## When to Use

Reading, writing, or searching notes in an Obsidian vault via MCP; managing tags; creating new notes; importing content; organizing the vault; using Obsidian as a knowledge base.

## When NOT to Use

Plain text files outside a vault (use regular file tools); "I'll just use Obsidian for this" when a file tool is faster; no Obsidian MCP available.

## Core Operations

| Action | Use |
|---|---|
| Read a note | `read_note` — by path, returns markdown |
| Search notes | `search_notes` — full-text search |
| Create note | `create_note` — path + content |
| Update note | `update_note` — path + new content |
| List notes in a folder | `list_notes` — by folder path |
| Get tags | `get_tags` — all tags in the vault |
| Add tag | `add_tag` — to a note |
| Search by tag | `search_by_tag` — all notes with tag |

## Note Convention

```markdown
title: My Note
tags: [project, reference]
created: 2024-01-01
aliases: [prod, main system]

# My Note

Content in markdown. Use wikilinks `[[Other Note]]` for cross-references.
Use `#tags` for inline tags. Use frontmatter for metadata.
```

- One concept per note.
- Wiki-links for cross-references.
- Frontmatter for metadata.
- Tags for categorization.
- Folders for organization.

## Common Patterns

```markdown
# Daily Note (YYYY-MM-DD)
## What I did
- Task 1
- Task 2

## What I learned
- Insight 1
- Insight 2

## Open questions
- Question 1
```

Use daily notes for session logs, project notes for persistent knowledge, reference notes for external documentation.

## Common Mistakes

One giant note (split it); no tags (can't find it); no frontmatter (missing metadata); broken wiki-links (typo); content in wrong folder; "I'll organize it later" (do it now); importing without categorization; no daily note for long sessions; duplication across notes; notes with no links (lonely notes); overwriting existing notes; using Obsidian for ephemeral content (use chat instead).

## Red Flags

"Giant note with everything"; no tags; no frontmatter; broken links; wrong folder; "organize later"; no daily note; duplicate notes; lonely notes; overwrite without merge; ephemeral content in vault; unlinked references; "I'll remember the structure" (you won't).

## Anti-Patterns

**One giant note** (split); **no tags**; **no frontmatter**; **broken links**; **wrong folder**; **"organize later"**; **no daily note**; **duplicate notes**; **overwriting**; **ephemeral content**; **no links**.
