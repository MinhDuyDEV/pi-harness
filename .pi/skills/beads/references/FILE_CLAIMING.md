# File Path Claiming (Multi-Agent Safety)

At multi-agent scale, agents editing the same files cause merge conflicts. File path claiming prevents this by making ownership explicit before any edit happens.

## When to Use

- **Single agent**: Optional — no conflicts possible
- **2-10 agents**: Recommended for files touched by multiple tasks
- **10+ agents**: Required — every file must be claimed before editing

## The Claim/Edit/Release Cycle

```bash
# 1. CLAIM: Declare intent to edit before touching the file
br reserve <bead-id> --files "src/auth/service.ts,src/auth/types.ts"
# → Marks files as owned by this bead
# → Other agents see the reservation and must wait

# 2. EDIT: Make your changes
# (edit files as normal)

# 3. VERIFY: Run gates before releasing
npm run typecheck && npm run lint

# 4. CLOSE: Release ownership when done
br close <bead-id> --reason "Auth service implemented. Gates passed."
# → Ownership released automatically on close
```

## File Claiming Checklist

- [ ] Check for conflicts: `br list --status in_progress --json | jq '.[].reserved_files'`
- [ ] Reserve files before editing: `br reserve <id> --files "..."`
- [ ] Run gates before closing: `npm run typecheck && npm run lint`
- [ ] Close bead to release ownership

## Checking for Conflicts Before Claiming

Before claiming, check if another bead already owns the file:

```bash
# See all reserved files across active beads
br list --status in_progress --json | jq '.[].reserved_files'

# If conflict detected:
# → Wait for the other bead to close
# → Or coordinate with the agent owning that bead
```

## Claiming in Delegation Packets

Workers MUST declare file claims in their delegation packet:

```markdown
# Delegation Packet

- TASK: task-1 - Implement auth service
- FILES TO CLAIM BEFORE EDITING:
  - src/auth/service.ts
  - src/auth/types.ts
  - src/auth/middleware.ts
- MUST NOT EDIT (owned by other tasks):
  - src/db/schema.ts (owned by task-0)
  - src/config.ts (owned by task-2)
```

## Conflict Resolution Protocol

When two agents want the same file:

| Scenario                             | Resolution                                      |
| ------------------------------------ | ----------------------------------------------- |
| File not claimed                     | Claim it and proceed                            |
| File claimed by completed bead       | Safe to claim (no active owner)                 |
| File claimed by in_progress bead     | Wait for bead to close, then claim              |
| Urgent: same file, different workers | Escalate to lead agent to split the file change |

## Anti-Pattern: Claiming After Editing

```bash
# WRONG — edit first, claim after → conflict already happened
edit src/auth/service.ts
br reserve bead-1 --files "src/auth/service.ts"

# RIGHT — claim first, then edit
br reserve bead-1 --files "src/auth/service.ts"
edit src/auth/service.ts
```

## Quick Reference: File Claiming

```
BEFORE EDITING (multi-agent):
  br reserve <id> --files "src/file.ts"

CHECK OWNERSHIP:
  br list --status in_progress --json | jq '.[].reserved_files'

RELEASE:
  br close <id> --reason "..."  ← auto-releases files
```
