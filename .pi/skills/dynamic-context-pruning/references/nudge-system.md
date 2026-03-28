# DCP Nudge System — Runtime-Enforced (v2.1)

> Nudges are now runtime-enforced via `turn_end` + `ctx.getContextUsage()`.
> The extension checks real token counts and triggers actions automatically.

## How It Works

On every `turn_end` event, the NudgeManager:

1. **Reads** `ctx.getContextUsage()` for real token count and percentage
2. **Computes** effective max threshold: `maxContextLimit + min(summaryTokens, summaryBuffer)`
   - Summary block tokens extend the effective limit (they represent already-compressed content)
   - Prevents "nudge storms" when sessions accumulate many compressed blocks
3. **Evaluates** against thresholds:
   - < 50k tokens → no action
   - 50k–effectiveMax → gentle nudge (if enough turns since last nudge)
   - > effectiveMax → critical nudge
   - > 80% of context → auto-compact (converted to critical nudge — Pi handles actual compaction)
4. **Includes** compression priority targets in nudge messages
5. **Sets** pending nudge message (injected on next `before_agent_start`)
6. **Updates** footer status via `ctx.ui.setStatus()`

## Summary Buffer

The `summaryBuffer` feature prevents premature nudges when you've compressed effectively:

```
Example:
  maxContextLimit = 150k
  Active summary blocks = 12k tokens
  summaryBuffer cap = 20k
  
  effectiveMax = 150k + 12k = 162k
  → Nudges won't fire until 162k (instead of 150k)
```

Summary tokens are already-compressed content that the model needs for context. Penalizing the agent for having good summaries is counterproductive.

## Compression Priority Map

Every `context` event computes a priority map of tool results by token size:

| Level | Threshold | Action |
|---|---|---|
| **High** | >5000 tokens total | Named in nudge messages — compress these first |
| **Medium** | 500-5000 tokens | Listed if few high-priority targets |
| **Low** | <500 tokens | Not worth compressing individually |

### How It Appears in Nudges

```
[DCP Nudge] Context at 120k tokens (60%).
Consider using `compress` to crystallize completed conversation ranges.
Focus on closed phases: finished research, verified implementations, resolved debugging.
Compression targets: **High-priority targets**: read (5x, ~25k), tilth_read (3x, ~12k)
```

The model sees exactly which tool results are consuming the most context, enabling targeted compression instead of guessing.

## Nudge Types

### Gentle Nudge
```
[DCP Nudge] Context at 85k tokens (42%).
Consider using `compress` to crystallize completed conversation ranges.
Focus on closed phases: finished research, verified implementations, resolved debugging.
Compression targets: **High-priority targets**: read (4x, ~18k)
```

### Strong Nudge
```
[DCP Warning] Context at 130k tokens (65%).
You SHOULD compress completed conversation ranges now.
Use the `compress` tool on your largest closed phase.
Compression targets: **High-priority targets**: tilth_read (6x, ~30k). **Medium targets**: grep (3x, ~4k)
```

### Critical Nudge
```
[DCP CRITICAL] Context at 160k tokens (80%) — approaching limit.
IMMEDIATELY compress the largest completed conversation range.
Auto-compaction will trigger at 80% if no action is taken.
Compression targets: **High-priority targets**: read (8x, ~40k)
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
- Converted to a critical nudge message (DCP does NOT call ctx.compact() directly — crashes)
- Pi's native auto-compaction handles the actual compaction
- Agent is urged to use `compress` tool to preserve important context before auto-compaction runs

## Configuration

```typescript
compress: {
  minContextLimit: 50_000,      // Below this: no nudges
  maxContextLimit: 150_000,     // Above this: critical nudges (adjusted by summaryBuffer)
  nudgeFrequency: 5,            // Turns between nudges
  iterationNudgeThreshold: 15,  // Consecutive assistant turns before iteration nudge
  nudgeForce: "soft",           // "soft" or "strong"
  summaryBuffer: 20_000,        // Max summary tokens that extend effective max
},
autoCompact: {
  enabled: true,
  thresholdPercent: 80,
  customInstructions: "Focus on preserving: key decisions, file paths, task state, next steps."
}
```
