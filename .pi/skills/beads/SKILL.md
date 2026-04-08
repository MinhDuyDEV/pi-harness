---
name: beads
description: >
  Multi-agent task coordination using br (beads_rust) CLI. Use when work spans multiple
  sessions, has dependencies, needs file locking, or requires agent coordination. Covers
  claim/reserve/done cycle, dependency management, hierarchical decomposition, and session protocols.
version: "2.0.0"
license: MIT
tags: [workflow, agent-coordination]
dependencies: []
---

# Beads Workflow - Multi-Agent Task Coordination

> **Replaces** ad-hoc task tracking with sticky notes, TODO comments, or mental checklists that lose state between sessions
## When to Use

- Coordinating multi-session work with dependencies, blockers, or file locking needs
- Running multi-agent work where tasks must persist across sessions and handoffs

## When NOT to Use

- Single-session, linear tasks tracked via TodoWrite
- Quick changes with no dependencies or handoff needs

## Overview

**br (beads_rust) CLI** replaces the old `bd` (beads) CLI with a faster Rust implementation.

**Key Distinction**:

- **br CLI**: Multi-session work, dependencies, file locking, agent coordination
- **TodoWrite**: Single-session tasks, linear execution, conversation-scoped

**When to Use br vs TodoWrite**:

- "Will I need this context in 2 weeks?" → **YES** = br
- "Does this have blockers/dependencies?" → **YES** = br
- "Multiple agents editing same codebase?" → **YES** = br
- "Will this be done in this session?" → **YES** = TodoWrite

**Decision Rule**: If resuming in 2 weeks would be hard without beads, use beads.

## Essential Commands

```bash
br ready              # Show issues ready to work (no blockers)
br list --status open # All open issues
br show <id>          # Full issue details with dependencies
br create --title "Fix bug" --type bug --priority 2 --description "Details here"
br update <id> --status in_progress
br close <id> --reason "Completed"
br sync --flush-only  # Export to JSONL (then git add/commit manually)
```

## Hierarchy & Dependencies (Summary)

- Beads supports up to 3 levels of hierarchy: Epic → Task → Subtask
- Use hierarchy for multi-day, cross-domain, or multi-agent work
- Dependencies unblock parallel work when parents close

See: `references/HIERARCHY.md` and `references/DEPENDENCIES.md` for full details.

## Session Protocol (Summary)

**Start:** `br ready` → `br update <id> --status in_progress` → `br show <id>`

**End:** `br close <id> --reason "..."` → `br sync --flush-only` → commit `.beads/` → restart session

See: `references/SESSION_PROTOCOL.md` and `references/WORKFLOWS.md` for detailed steps and checklists.

## Task Creation (Summary)

Create tasks when work spans sessions, has dependencies, or is discovered mid-implementation (>2 min).

```bash
br create --title "Fix authentication bug" --priority 0 --type bug
```

See: `references/TASK_CREATION.md` for full examples and patterns.

## Git Sync (Summary)

`br` never runs git commands. Always `br sync --flush-only` and commit `.beads/` manually.

See: `references/GIT_SYNC.md` for detailed flow and cleanup guidance.

## Troubleshooting (Summary)

- No ready tasks → `br list --status open`, check blockers via `br show <id>`
- Sync failures → `br doctor`

See: `references/TROUBLESHOOTING.md` for common issues and fixes.

## Examples

See: `references/EXAMPLES.md` for complete usage examples.

## Multi-Agent Coordination (Summary)

For parallel execution with multiple subagents, use the **beads-bridge** skill.

See: `references/MULTI_AGENT.md` for swarm tool usage and examples.

## Rules

1. **Check `br ready` first** - Find unblocked work before starting
2. **Claim before editing** - `br update <id> --status in_progress`
3. **One task per session** - Restart after `br close`
4. **Always sync and commit** - `br sync --flush-only` then `git add .beads/ && git commit`
5. **Write notes for future agents** - Assume zero conversation context
6. **Claim file paths before editing** - Use reserve to declare ownership (multi-agent only)

## Anti-Patterns

| Anti-Pattern | Why It Fails | Instead |
| --- | --- | --- |
| Claiming a bead without reading its current state first (`br show`) | Misses dependencies, blockers, and prior context | Run `br show <id>` before `br update <id> --status in_progress` |
| Closing a bead without verification evidence | Marks incomplete or broken work as done | Run verification commands and capture output before `br close` |
| Working on blocked beads (dependencies not met) | Wastes time and causes out-of-order delivery | Use `br ready` and confirm dependencies in `br show <id>` |
| Modifying bead state without user confirmation | Violates workflow expectations and can surprise collaborators | Ask before changing bead status, especially close/sync actions |
| Using `br sync` without `--flush-only` (can cause conflicts) | May write unexpected state and increase sync conflict risk | Always use `br sync --flush-only` then commit `.beads/` manually |

## Verification

- **Before closing:** run verification commands, paste output as evidence
- **After close:** `br show <id>` confirms `status=closed`
- **After sync:** `git status` shows clean working tree

## File Path Claiming (Summary)

Claim files before editing in multi-agent work using `br reserve <id> --files "..."`.

See: `references/FILE_CLAIMING.md` for the full protocol and examples.

## Best Practices (Summary)

- One task per session, then restart
- File issues for work >2 minutes
- Weekly `br doctor`, periodic `br cleanup --days 7`

See: `references/BEST_PRACTICES.md` for maintenance and database health guidance.

## Quick Reference

```
SESSION START:
  br ready → br update <id> --status in_progress → br show <id>

DURING WORK:
  br create for discovered work (>2min)
  br show <id> for context

SESSION END:
  br close <id> --reason "..." → br sync --flush-only → git add .beads/ && git commit → RESTART SESSION

MAINTENANCE:
  br doctor - weekly health check
  br cleanup --days 7 - remove old issues
```

## References

- `references/BOUNDARIES.md`
- `references/RESUMABILITY.md`
- `references/DEPENDENCIES.md`
- `references/WORKFLOWS.md`
- `references/HIERARCHY.md`
- `references/SESSION_PROTOCOL.md`
- `references/TASK_CREATION.md`
- `references/GIT_SYNC.md`
- `references/TROUBLESHOOTING.md`
- `references/EXAMPLES.md`
- `references/MULTI_AGENT.md`
- `references/FILE_CLAIMING.md`
- `references/BEST_PRACTICES.md`

## See Also

- `verification-before-completion`
- `beads-bridge`
