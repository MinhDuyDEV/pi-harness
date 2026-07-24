# DeepSeek Provider Extension for pi-harness

A Pi custom provider extension bringing DeepSeek-specific optimizations
stolen from [Reasonix](https://github.com/esengine/DeepSeek-Reasonix).

## Architecture

```
deepseek-provider.ts    → Main extension entry, registers provider + stream handler
deepseek/
  thinking.ts           → isThinkingModeModel(), stripHallucinatedToolMarkup()
  repair.ts             → fixToolCallPairing(), stampMissingReasoning(), repairTruncatedJson()
  scavenge.ts           → analyzeSchema(), repairSchema() for DeepSeek compat
  storm.ts              → StormBreaker (repeat-loop guard)
  shrink.ts             → Token-aware tool result shrinking
  retry.ts              → fetchWithRetry() with body draining
  sse.ts                → OpenAI-compatible SSE stream parser
  flat-args.ts          → Schema flattening for deep/nested tools
```

## P0-P3 Implementation Status

| Priority | Feature | Status | Location |
|---|---|---|---|
| P0 | `isThinkingModeModel()` | ✅ | `deepseek/thinking.ts` |
| P0 | `stripHallucinatedToolMarkup()` | ✅ | `deepseek/thinking.ts` |
| P0 | `fixToolCallPairing()` | ✅ | `deepseek/repair.ts` |
| P0 | `stampMissingReasoningForThinkingMode()` | ✅ | `deepseek/repair.ts` |
| P1 | `repairTruncatedJson()` | ✅ | `deepseek/repair.ts` |
| P1 | `repairSchema()` / scavenge | ✅ | `deepseek/scavenge.ts` |
| P1 | StormBreaker | ✅ | `deepseek/storm.ts` |
| P2 | Cache-aligned message assembly | ✅ | `deepseek-provider.ts` (streamSimple) |
| P2 | Token-aware shrinking | ✅ | `deepseek/shrink.ts` |
| P2 | Retry with body draining | ✅ | `deepseek/retry.ts` |
| P3 | Schema flattening | ✅ | `deepseek/flat-args.ts` |
| P3 | Cost telemetry | ✅ | `deepseek-provider.ts` (usage tracking) |

## Models Registered

| Model | Description | Context | Max Output | Input/M | Output/M | Cache Hit/M |
|---|---|---|---|---|---|---|
| `deepseek-chat` | Deprecated → v4-flash non-thinking | 1M | 384K | $0.14 | $0.28 | $0.0028 |
| `deepseek-reasoner` | Deprecated → v4-flash thinking | 1M | 384K | $0.14 | $0.28 | $0.0028 |
| `deepseek-v4-flash` | V4 Flash (fast, balanced) | 1M | 384K | $0.14 | $0.28 | $0.0028 |
| `deepseek-v4-pro` | V4 Pro (best quality) | 1M | 384K | $0.435 | $0.87 | $0.003625 |

> V4 Pro pricing is promotional (75% off until 2026-05-31). After that, prices are permanently set to 1/4 of original.
> `deepseek-chat` and `deepseek-reasoner` are deprecated aliases for `deepseek-v4-flash` modes.

## Usage

1. The extension auto-loads when placed in `.pi/extensions/`
2. Set `DEEPSEEK_API_KEY` in environment
3. In Pi, run `/model` and select a deepseek model
4. Run `/model deepseek-v4-pro` for best quality, `/model deepseek-v4-flash` for speed

## What Gets Repaired

When you use a DeepSeek model, the extension automatically:

- **Before API call**: Heals tool-call pairing, stamps missing `reasoning_content`,
  shrinks oversized tool results, scavenges tool schemas
- **During streaming**: Strips hallucinated DSML markup from content
- **After completion**: Repairs truncated JSON arguments, detects repeat-loop storms
- **On retry**: Exponential backoff with jitter, body draining, Retry-After respect
