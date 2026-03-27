# DCP Nudge System — Runtime-Enforced (v2)

> Nudges are now runtime-enforced via `turn_end` + `ctx.getContextUsage()`.
> The extension checks real token counts and triggers actions automatically.

## How It Works

On every `turn_end` event, the NudgeManager:

1. **Reads** `ctx.getContextUsage()` for real token count and percentage
2. **Evaluates** against thresholds:
   - < 50k tokens → no action
   - 50k–150k → gentle nudge (if enough turns since last nudge)
   - > 150k → critical nudge
   - > 80% of context → auto-compact via `ctx.compact()`
3. **Sets** pending nudge message (injected on next `before_agent_start`)
4. **Updates** footer status via `ctx.ui.setStatus()`

## Nudge Types

### Gentle Nudge
```
[DCP Nudge] Context at 85k tokens (42%).
Consider using `compress` to crystallize completed conversation ranges.
Focus on closed phases: finished research, verified implementations, resolved debugging.
```

### Strong Nudge
```
[DCP Warning] Context at 130k tokens (65%).
You SHOULD compress completed conversation ranges now.
Use the `compress` tool on your largest closed phase.
```

### Critical Nudge
```
[DCP CRITICAL] Context at 160k tokens (80%) — approaching limit.
IMMEDIATELY compress the largest completed conversation range.
Auto-compaction will trigger at 80% if no action is taken.
```

### Iteration Nudge
```
[DCP Iteration] 15 consecutive turns without user input.
Context at 95k tokens (48%). Check if any phases are complete and can be compressed.
```

## Debouncing

- Nudges are suppressed for `nudgeFrequency` turns (default 5) after the last nudge
- Calling `compress` resets the nudge timer
- Auto-compact only fires once per cycle (reset on compaction)

## Auto-Compact

When context exceeds `autoCompact.thresholdPercent` (default 80%):
- `ctx.compact()` is called with custom instructions
- Default instructions focus on preserving: key decisions, file paths, task state, next steps
- On completion, a notification is shown
- On failure, error is reported — agent can retry manually

## Configuration

```typescript
compress: {
  minContextLimit: 50_000,      // Below this: no nudges
  maxContextLimit: 150_000,     // Above this: critical nudges
  nudgeFrequency: 5,            // Turns between nudges
  iterationNudgeThreshold: 15,  // Consecutive assistant turns before iteration nudge
  nudgeForce: "soft",           // "soft" or "strong"
},
autoCompact: {
  enabled: true,
  thresholdPercent: 80,
  customInstructions: "Focus on preserving: key decisions, file paths, task state, next steps."
}
```
