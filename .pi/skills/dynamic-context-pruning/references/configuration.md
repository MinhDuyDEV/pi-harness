# DCP Configuration Reference (v2.1)

## Core Settings

| Key | Default | Purpose |
|---|---|---|
| `enabled` | `true` | Enable/disable DCP entirely |
| `debug` | `false` | Log strategy actions to console |
| `pruneNotification` | `"detailed"` | `"off"`, `"minimal"`, `"detailed"` |

## Compression

| Key | Default | Purpose |
|---|---|---|
| `compress.permission` | `"allow"` | `"allow"`, `"ask"`, `"deny"` |
| `compress.maxContextLimit` | `150,000` | Critical nudge threshold (tokens) |
| `compress.minContextLimit` | `50,000` | Below this, nudges are off |
| `compress.nudgeFrequency` | `5` | Min turns between nudges |
| `compress.iterationNudgeThreshold` | `15` | Consecutive turns before iteration nudge |
| `compress.nudgeForce` | `"soft"` | `"soft"` or `"strong"` |
| `compress.protectedTools` | see below | Tools exempt from compression |
| `compress.summaryBuffer` | `20,000` | Max tokens for accumulated summaries |
| `compress.mode` | `"range"` | `"range"` or `"message"` |

## Runtime Strategies

| Key | Default | Purpose |
|---|---|---|
| `strategies.deduplication.enabled` | `true` | Auto-strip duplicate tool calls |
| `strategies.supersedeWrites.enabled` | `true` | Auto-strip superseded write inputs |
| `strategies.purgeErrors.enabled` | `true` | Auto-strip old errored tool inputs |
| `strategies.purgeErrors.turns` | `4` | Turns to wait before purging |

## Auto-Compact (v2)

| Key | Default | Purpose |
|---|---|---|
| `autoCompact.enabled` | `true` | Auto-trigger ctx.compact() |
| `autoCompact.thresholdPercent` | `80` | Context % threshold to trigger |
| `autoCompact.customInstructions` | (see below) | Instructions for auto-compaction |

Default instructions: *"Focus on preserving: key decisions, file paths modified, current task state, and next steps. Be thorough but concise."*

## Deferred Drop Queue (v2)

| Key | Default | Purpose |
|---|---|---|
| `dropQueue.enabled` | `true` | Enable cache-aware deferred drops |
| `dropQueue.cacheTTL.defaultMs` | `300,000` (5min) | Default cache TTL |
| `dropQueue.cacheTTL.perModel` | (per-model map) | Override TTL per model |
| `dropQueue.executeThresholdPercent` | `65` | Force-execute all drops at this % |
| `dropQueue.protectedTags` | `20` | Last N tags immune from drops |

## Tagging (v2)

| Key | Default | Purpose |
|---|---|---|
| `tagging.enabled` | `true` | Enable monotonic message tagging |

## Fact Extraction (v2)

| Key | Default | Purpose |
|---|---|---|
| `factExtraction.enabled` | `true` | Extract facts from compaction |
| `factExtraction.categories` | all 8 | Categories to extract |
| `factExtraction.promotionThreshold` | `3` | Retrievals needed for promotion |

Categories: `ARCHITECTURE_DECISIONS`, `CONSTRAINTS`, `NAMING_CONVENTIONS`, `KNOWN_ISSUES`, `WORKFLOW_RULES`, `DEPENDENCIES`, `FILE_PATTERNS`, `API_CONTRACTS`

## Expand / Reversible Compression (v2)

| Key | Default | Purpose |
|---|---|---|
| `expand.enabled` | `true` | Store raw transcripts for expansion |
| `expand.maxExpandTokens` | `15,000` | Max tokens returned per expansion |

## Historian (v3 — Future)

| Key | Default | Purpose |
|---|---|---|
| `historian.enabled` | `false` | Background compression agent (opt-in) |
| `historian.model` | `"haiku"` | Model for background summarization |
| `historian.timeoutMs` | `300,000` | Timeout per historian call |
| `historian.chunkTokenBudget` | `20,000` | Input chunk size for historian |

## Protected Tools

Default protected from all strategies:
```
task, skill, todowrite, todoread, compress, batch,
plan_enter, plan_exit, write, edit, observation,
memory-update, memory-read
```
