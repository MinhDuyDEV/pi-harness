# Error Handling

## Common Issues

**No ready tasks**

- Run `br list --status open` to see all tasks
- Some may be blocked - check dependencies with `br show <id>`

**Sync failures**

- Run `br doctor` to repair database
- Check git remote access

## Database Lock / WAL Conflicts

**Symptoms:**

- `SQLITE_BUSY` or `SQLITE_LOCKED` errors when reading beads
- Stale `.beads/beads.db-wal` or `.beads/beads.db-journal` files after agent crash

**Cause:**
Agent interruption during bead operations can leave WAL/journal files in an inconsistent state.

**Fix:**

1. Ensure no agents are actively writing to beads.db
2. Remove stale lock files:
   ```bash
   rm -f .beads/beads.db-wal .beads/beads.db-journal
   ```
3. Run `br sync --flush-only` to rebuild from JSONL source of truth
4. Verify: `br ready` should work without errors

**Prevention:**

- The memory plugin now retries bead.db reads automatically (3 attempts, 500ms delay)
- If persistent, check for zombie agent processes: `ps aux | grep opencode`
