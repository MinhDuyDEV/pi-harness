# Git Sync

## Manual Sync (Non-Invasive)

**Important:** `br` never executes git commands. You must manually commit changes.

```bash
# Export changes to JSONL
br sync --flush-only

# Then manually commit
git add .beads/
git commit -m "sync beads"
git push
```

**Use when**: End of session, before handoff, after major progress.

## Cleanup Old Issues

```bash
br cleanup --days 7
```

Removes closed issues older than N days. Run weekly.
