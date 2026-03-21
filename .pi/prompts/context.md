---
description: Show context window usage, token costs, and compression stats
argument-hint: "[--today] [--all]"
---

# Context: $ARGUMENTS

Quick, read-only context dashboard for this session.

Combines:
- `/usage` (token + cost stats)
- `/dcp` (compression status)
- `dcp-stats` tool (detailed compression stats)

## Parse Arguments

| Argument  | Default | Description |
| --------- | ------- | ----------- |
| `--today` | false   | Focus on today/session only (hide all-time extras) |
| `--all`   | false   | Include global DCP + all-time usage details |

## Before You Run

- **Read-only only**: do not modify files, DB, or session state
- **Use real outputs**: never invent token/cost numbers
- **Prefer concise display**: quick-glance dashboard, not a narrative report

## Phase 1: Gather Data

Run these first (required):

```text
/usage
/dcp
```

Then run detailed DCP stats:

```typescript
dcp-stats({ scope: "session" })
```

If `--all` is provided, also run:

```typescript
dcp-stats({ scope: "global" })
```

Get current DCP budget settings from:
- `.pi/extensions/dcp/config.ts` (`DEFAULT_CONFIG.compress`)

Get session-level usage details from usage-tracker SQLite (read-only):
- DB: `~/.config/pi/usage/usage.db`
- Tables: `session_summary`, `usage_events`
- Prefer current `session_id` when known; otherwise use most recently updated session

Required session fields:
- `total_input`, `total_output`, `total_cache`, `total_thinking`, `total_cost_usd`, `total_turns`
- `model`, `provider`

## Phase 2: Build Unified Dashboard

Render as terminal-friendly tables.

### Context Dashboard

| Metric | Session | Today | Notes |
| ------ | ------- | ----- | ----- |
| Input tokens | ... | ... | from usage data |
| Output tokens | ... | ... | from usage data |
| Cache tokens | ... | ... | from usage data |
| Thinking tokens | ... | ... | from usage data |
| Estimated cost | ... | ... | USD |
| Model / Provider | ... | ... | current session model |
| Active DCP blocks | ... | ... | from `/dcp` + `dcp-stats` |
| Tokens compressed | ... | ... | from DCP stats |
| Tokens pruned/saved | ... | ... | from DCP stats |

### Context Budget

Use DCP config + session token totals to estimate budget pressure.

| Budget Metric | Value |
| ------------- | ----- |
| Estimated context used | ... tokens |
| Min threshold | ... tokens |
| Max threshold | ... tokens |
| Usage vs max | ...% |
| Avg tokens/turn | ... |
| Estimated remaining turns | ... |
| Compaction mode | permission=..., nudge=... |

Estimation guidance:
- `estimated_context_used = input + output + thinking` (cache tokens are a subset of input, not additive)
- `usage_vs_max = estimated_context_used / maxContextLimit`
- `avg_tokens_per_turn = estimated_context_used / max(total_turns, 1)`
- `remaining_turns = (maxContextLimit - estimated_context_used) / max(avg_tokens_per_turn, 1)`
- Always mark estimates with `~`

## Phase 3: Budget Recommendations

Give 1-3 short recommendations only:

- `>= 80%` max budget: **Compress now** (run `compress` on closed ranges)
- `60-79%`: **Prepare compression soon** (next 1-2 turns)
- `< 60%`: **Healthy** (continue, monitor every ~5 turns)

Also include:
- Whether DCP active blocks are accumulating effectively
- If `--all`, add one line comparing session vs global compression efficiency

## Output

```text
Context
━━━━━━━

[Context Dashboard table]

[Context Budget table]

Next:
1) ...
2) ...
```
