# pi-rewind (ported to pi SDK 0.79+)

Operation-level undo/redo for the pi coding agent. Forked from
[nicobailon/pi-rewind-hook](https://github.com/nicobailon/pi-rewind-hook) and
ported to the current `@earendil-works/pi-coding-agent` SDK. See `PORT.md`
for the list of API-surface changes.

## How to use

This extension has **no slash commands**. It is wired entirely through pi
events. The user-facing flow is:

1. Use pi's built-in **`/tree`** command to open the session-tree picker.
2. Pick a user message (or any earlier entry) to navigate to.
3. The extension intercepts the navigation in its `session_before_tree`
   handler and shows a picker:
   - **Restore files to that point** — rolls the working tree back to
     the state before the picked turn.
   - **Don't restore files** — only navigates the conversation tree
     (files stay as they are).
   - **Cancel** — aborts the navigation entirely.
4. If you picked a turn that the extension cannot restore, it cancels
   the navigation rather than rolling forward or back inconsistently.

The "redo" is just navigating forward in the tree again. There is no
explicit `/redo`; the picker is symmetric in both directions.

## Events the extension hooks

| Event                       | What it does |
| --------------------------- | ------------ |
| `before_agent_start`        | Injects context about the rewind store when a turn starts |
| `session_start`             | Rehydrates the rewind store from the JSONL ledger |
| `session_tree`              | After a tree navigation, files are restored or marked dirty |
| `session_compact`           | Records the rewind store size before compaction |
| `session_shutdown`          | Persists the rewind store to JSONL |
| `turn_start` / `turn_end`   | Captures a per-turn git snapshot of the working tree |
| `agent_end`                 | Finalises the per-turn rewind record |
| `session_before_fork`       | Captures a snapshot before a fork so the new session has context |
| `session_before_tree`       | Asks the user whether to restore files when navigating |

## Storage

- **Per-session ledger** — `CustomEntry` records written into the
  session JSONL at `.pi/agent/sessions/--<cwd>--/<timestamp>_<uuid>.jsonl`
- **File snapshots** — git tree objects stored under the user's git
  ref `refs/pi-rewind/store` with a keepalive chain so `git gc` does
  not reap them.
- **Untracked files** — recorded at snapshot time, restored on demand
  via the `preexistingUntrackedFiles` whitelist. Files the user
  created by hand after the snapshot are preserved.
- **Large files** — files above the configured size cap are skipped
  from snapshots; tracked separately in `skippedLargeFiles`.

## Out of scope (intentional)

- No `/undo` or `/redo` slash commands. The upstream author chose the
  `/tree`-picker design. If you want a fast `Cmd+Z`-style shortcut,
  see `PORT.md` § "Out of scope / future work".
- No support for non-git worktrees. Pi's resource loader already
  requires a git repo for project extensions, and rewind depends on
  git tree objects.

## File

```
.pi/extensions/rewind/
├── index.ts          (1,461 lines — ported from upstream)
├── index.test.ts     (752 lines — pre-existing upstream test suite)
├── package.json      (pi-rewind v2.0.0, pinned to @earendil-works/pi-coding-agent ^0.79.0)
├── tsconfig.json
├── PORT.md           (port notes)
└── README.md         (this file)
```
