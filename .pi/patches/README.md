# Pikit Runtime Overrides

This directory tracks **runtime overrides** for upstream pi packages.

## Current strategy (stable)

### 1) `@tintinweb/pi-tasks` is forked locally

- Active package source: `.pi/forks/pi-tasks`
- Installed via symlink from `.pi/npm/package.json`:

```json
"@tintinweb/pi-tasks": "file:../forks/pi-tasks"
```

### 2) `@tintinweb/pi-subagents` stays upstream

- Optional local patch copy is kept for resilience:
  - `pi-subagents-index.ts.patched`

## What is in the local `pi-tasks` fork

The fork includes these behavior fixes:

1. Cascade data flow (`buildTaskPrompt` injects prerequisite results)
2. Retry-with-feedback (up to 2 retries with error + partial output context)
3. Episode-aware cascade gating (block cascade on partial/blocked/failure)
4. Model forwarding for direct spawn/cascade/retry
5. RPC compatibility in `rpcCall` (accepts both envelope and legacy bare payload replies)
6. Version check hardening (ignores malformed ping replies like `{}`)

## Optional: reapply subagents src patch

If `@tintinweb/pi-subagents` is reinstalled and you need the session context fix:

```bash
cp .pi/patches/pi-subagents-index.ts.patched \
  .pi/npm/node_modules/@tintinweb/pi-subagents/src/index.ts
```

## Verify active fork wiring

```bash
ls -ld .pi/npm/node_modules/@tintinweb/pi-tasks
# Expected: symlink -> ../../../forks/pi-tasks

node -e "const lock=require('./.pi/npm/package-lock.json'); console.log(lock.packages['node_modules/@tintinweb/pi-tasks'])"
# Expected: { resolved: '../forks/pi-tasks', link: true }
```
