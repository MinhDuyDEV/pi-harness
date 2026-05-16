# Pikit Runtime Overrides

Active runtime patch:

- `pi-vcc-tui-safe-lines.patch` — wraps long `@sting8k/pi-vcc` compaction summary lines at 120 chars so Pi's compaction TUI does not render huge mostly-empty blocks with scattered text.

Reapply after reinstalling Pi npm packages:

```bash
bash .pi/patches/apply-runtime-patches.sh
```

Runtime otherwise uses upstream packages directly:

- `@tintinweb/pi-subagents` — agent spawning, RPC handlers
- `@tintinweb/pi-tasks` — task DAG, TaskExecute, cascade

## Rule

Keep a **single authoritative** responder for `subagents:rpc:*` events.
Do not add custom bridge extensions or duplicate subagent packages.

## Upstream PR

Cascade data injection + model forwarding submitted as:
https://github.com/tintinweb/pi-tasks/pull/7

If merged, available via `pi install` / `npm install` with no local patches.
