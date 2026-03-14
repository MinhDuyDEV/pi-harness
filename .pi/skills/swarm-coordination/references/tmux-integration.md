# Tmux Integration (Visual Swarm Monitoring)

Enable real-time visualization of swarm workers in separate tmux panes.

## Setup

1. Start OpenCode inside tmux:

```bash
tmux new -s opencode
opencode
```

2. The tmux tool auto-detects when running inside tmux and uses these defaults:
   - Layout: `main-vertical` (leader left, workers right)
   - Main pane size: 60%
   - Auto-cleanup: enabled

## Detecting Tmux

```typescript
// Check if running inside tmux
const status = await tmux({ operation: "detect" });
const { available, inside_session } = JSON.parse(status);

if (!inside_session) {
  console.log("Tip: Run inside tmux for visual swarm monitoring");
  console.log("Start with: tmux new -s opencode");
}
```

## Spawning Worker Panes

When spawning workers, create visual panes:

```typescript
// Before spawning worker via Task tool
if (inside_session) {
  // Create pane for this worker
  const pane = await tmux({
    operation: "spawn",
    worker_id: "worker-1",
    title: "Explorer: auth.ts",
    size: 40, // 40% width
  });

  const { pane_id } = JSON.parse(pane);

  // Send command to pane (optional - for visual feedback)
  await tmux({
    operation: "send",
    pane_id,
    command: `echo "🔍 Worker-1: Exploring auth.ts..."`,
  });
}

// Spawn the actual worker
await Task({
  subagent_type: "general",
  description: "Execute worker-1",
  prompt: `...`,
});
```

## Layout Options

| Layout            | Description                           | Best For                      |
| ----------------- | ------------------------------------- | ----------------------------- |
| `main-vertical`   | Main pane left, workers stacked right | Default, good for 2-4 workers |
| `main-horizontal` | Main pane top, workers below          | Wide monitors                 |
| `tiled`           | Equal grid for all panes              | Many workers (5+)             |
| `even-horizontal` | Equal width columns                   | 2-3 workers                   |
| `even-vertical`   | Equal height rows                     | 2-3 workers                   |

```typescript
// Change layout dynamically
await tmux({
  operation: "layout",
  layout: "tiled", // When many workers spawn
});
```

## Monitoring Worker Output

```typescript
// Capture output from a worker's pane
const output = await tmux({
  operation: "capture",
  pane_id: "%5",
});

// Check what the worker is doing
console.log(JSON.parse(output).output);
```

## Cleanup

```typescript
// Kill specific pane when worker completes
await tmux({
  operation: "kill",
  pane_id: "%5",
});

// Or cleanup all spawned panes at end of swarm
await tmux({
  operation: "cleanup",
});
```

## User Commands

| Action                  | Keys          |
| ----------------------- | ------------- |
| Switch to next pane     | `Ctrl+B →`    |
| Switch to previous pane | `Ctrl+B ←`    |
| Zoom current pane       | `Ctrl+B z`    |
| Detach (keep running)   | `Ctrl+B d`    |
| Reattach                | `tmux attach` |
| List all panes          | `Ctrl+B w`    |

## Watch Command

Use `/swarm-watch` for real-time progress monitoring:

```bash
/swarm-watch my-swarm-team
```

This renders the beautiful TUI block and shows:

- Worker progress percentages
- Current files being worked on
- Completion status
