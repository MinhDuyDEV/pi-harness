---
name: obsidian
description: >-
  Operates an Obsidian vault through the @mauricio.wolff/mcp-obsidian MCP server (read/write notes,
  frontmatter, full-text search, tags). User-invoked: load via /skill:obsidian when the user asks to
  read, create, organize, or search notes in their Obsidian vault.
metadata:
  version: 1.0.0
  tags:
  - integration
  - documentation
  dependencies: []
disable-model-invocation: true
---

# Obsidian (MCP)

Tools come from the `@mauricio.wolff/mcp-obsidian` server declared in this skill's `mcp.json`. It requires `OBSIDIAN_VAULT_PATH` pointing at the vault root. Paths in tool calls are vault-relative.

## When to Use

The user's knowledge base is an Obsidian vault and they want notes read, written, searched, or reorganized.

## When NOT to Use

Plain files outside a vault (use regular file tools); the Obsidian MCP server is not configured.

## Tools

| Tool | Use |
|---|---|
| `read_note` / `read_multiple_notes` | Note content by path |
| `get_frontmatter` / `get_notes_info` | Metadata without loading full content |
| `list_directory` | Notes and folders under a path |
| `write_note` | Create or overwrite a note |
| `update_frontmatter` | Change metadata without touching the body |
| `move_note` / `delete_note` | Relocate or remove (check backlinks first) |
| `search_notes` | Full-text search across the vault |
| `manage_tags` | Add, remove, or list tags |

## Vault Conventions

- One concept per note; `[[wikilinks]]` for cross-references; frontmatter for metadata; tags for categorization.
- **Search before writing.** Run `search_notes` first; extend the existing note instead of creating a duplicate.
- **Read before overwriting.** `write_note` replaces content — read the note and merge, don't clobber.
- Prefer `update_frontmatter` over rewriting the whole note for metadata-only changes.
- Daily notes (`YYYY-MM-DD`) for session logs; project notes for persistent knowledge.

## Red Flags

Writing without searching first (duplicates); `write_note` over an existing note without reading it (silent overwrite); `move_note` without fixing backlinks (broken wikilinks); ephemeral scratch content in the vault (use the conversation); one giant note instead of small linked notes.
