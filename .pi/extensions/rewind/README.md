# pi-rewind (Pi SDK 0.81.1)

Operation-level working-tree snapshots for Pi's conversation fork/tree flows. The extension records exact git trees, maps session entries to snapshot commits, and lets users decide whether navigation should also restore files.

## Requirements

- Pi Coding Agent `0.81.1` (the tested target)
- A git working tree
- Node.js `>=22.19.0`

Non-git sessions remain usable; rewind status and snapshot behavior are simply disabled.

## User flow

The extension has no slash commands. During `/tree` navigation it offers:

- **Keep current files**
- **Restore files to that point** when the selected entry has a live snapshot
- **Undo last file rewind** when an undo snapshot exists
- **Cancel navigation**

During a fork it offers the equivalent conversation-only, restore-all, code-only, undo, and cancel choices. Headless forks keep current files. Restore failures cancel the navigation rather than leaving the conversation and working tree out of sync.

## Event contract

| Event | Responsibility |
| --- | --- |
| `before_agent_start` | Remember the active user prompt for turn binding |
| `turn_start` / `turn_end` | Capture the pre-turn and assistant-result snapshots |
| `agent_end` | Persist the completed turn ledger and trigger threshold retention |
| `session_start` | Reconstruct state and import pending fork metadata |
| `session_before_fork` / `session_before_tree` | Ask how file state should follow navigation |
| `session_tree` / `session_compact` | Bind resulting summary/compaction entries to snapshots |
| `session_shutdown` | Run the configured retention sweep |
| `rewind:checkpoint-entry` | Bind an allowlisted integration entry to the current tree |
| `rewind:fork-preference` | Apply an allowlisted one-shot conversation-only preference |

## Storage and retention

- Snapshot commits are kept alive through `refs/pi-rewind/store`.
- Session JSONL stores `rewind-turn`, `rewind-op`, and `rewind-fork-pending` custom entries.
- Snapshot capture uses a temporary git index and `git add -A`; the real index is not mutated.
- Restore deletes only repo-relative paths that disappeared between snapshots, then uses `git restore` from the target commit.
- Optional retention settings support maximum snapshot count, age, labeled-entry pinning, repository-session scanning, and a startup time budget.

## Modules

```text
.pi/extensions/rewind/
├── index.ts          # Pi registration and runtime lifecycle
├── events.ts         # fork/tree/turn event handlers
├── core.ts           # shared types, settings, and pure helpers
├── store.ts          # git snapshot store and exact restore operations
├── ledger.ts         # JSONL ledger parsing and lineage reconstruction
├── retention.ts      # live-set selection and store pruning
├── index.test.ts     # integration behavior
├── ledger.test.ts    # focused parser behavior
├── package.json
├── tsconfig.json
├── PORT.md
└── README.md
```

## Verify

```bash
node --import tsx --test .pi/extensions/rewind/index.test.ts .pi/extensions/rewind/ledger.test.ts
npm run typecheck:extensions
```

See `PORT.md` for SDK migration history.
