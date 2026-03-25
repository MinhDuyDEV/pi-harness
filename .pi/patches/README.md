# Pikit Runtime Overrides

No active patches or forks. Runtime uses upstream packages directly:

- `@tintinweb/pi-subagents` — agent spawning, RPC handlers
- `@tintinweb/pi-tasks` — task DAG, TaskExecute, cascade

## Rule

Keep a **single authoritative** responder for `subagents:rpc:*` events.
Do not add custom bridge extensions or duplicate subagent packages.

## Upstream PR

Cascade data injection + model forwarding submitted as:
https://github.com/tintinweb/pi-tasks/pull/7

If merged, available via `pi install` / `npm install` with no local patches.
