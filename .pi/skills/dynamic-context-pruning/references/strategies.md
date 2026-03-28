# DCP Strategies — Runtime-Enforced (v2.1)

> These strategies run automatically via the `context` event before every LLM call.
> No agent action required — they execute at the extension level.

## Strategy 0: Compress-Strip (with Nested Block Overlap)

**Rule**: When the agent calls `compress`, the summary is stored but original messages stay in context. This strategy strips the originals and injects the summary.

**How it works**:
- Finds compress tool_result messages in the context
- Identifies the message range that was compressed
- Strips the original messages and the compress call/result
- Injects a compact `dcp-compressed-summary` custom message with the summary

**Nested block overlap** (v2.1): When a new compress range overlaps an older compressed block, the old block's summary is embedded in the new one to prevent information loss through compression layers:

```
[Previously compressed content]
Auth research completed, decided to use OAuth2 with PKCE flow.

[Current compression]
Implemented OAuth2 auth module with PKCE flow. Created auth.ts and middleware.ts.
```

This ensures that even if the model didn't fully include older context in its new summary, the information is preserved.

## Strategy 1: Deduplication

**Rule**: When the same tool is called with the same arguments multiple times, only the most recent result matters.

**How it works**:
- Extension tracks tool_name + params_hash for every tool call
- In the `context` event, groups tool calls by signature
- For groups with > 1 call, strips content from older calls
- Keeps only the latest result per signature

**Example**:
```
Turn 3: read("src/auth.ts") → shows version A
Turn 7: read("src/auth.ts") → shows version B (latest)
→ Turn 3 content stripped: "[DCP: deduplicated — see latest call]"
```

**Protected from dedup**: task, skill, todowrite, todoread, compress, batch, write, edit, observation, memory-update, memory-read

## Strategy 2: Supersede-Writes

**Rule**: When a file is written (write/edit) then later read, the write's input content is redundant.

**How it works**:
- Tracks write/edit tool calls with file paths
- Tracks read/tilth_read tool calls with file paths
- If a read happens AFTER a write to the same file, the write input is stripped
- Write confirmation (success/error) is preserved

**Example**:
```
Turn 2: write("src/config.ts", 50 lines of content) → success
Turn 5: read("src/config.ts") → shows current state
→ Turn 2 write input replaced with: { path: "src/config.ts", _dcp_superseded: true }
```

## Strategy 3: Purge Errors

**Rule**: After 4+ turns, strip large input content from errored tool calls.

**How it works**:
- Identifies tool_result entries with is_error=true
- Finds corresponding tool_use entries
- If the call is 4+ turns old AND input > 200 chars, strips the input
- Error message is preserved for debugging context

**Example**:
```
Turn 3: write("src/bad-path.ts", 500 lines) → ERROR: file not found
Turn 7: (4 turns later)
→ Turn 3 input replaced with: { _dcp_error_purged: true, _tool: "write" }
   Error message preserved: "file not found"
```

## Deferred Drop Strategy

**Rule**: Cache-aware deferred drops strip content from tool calls whose cache TTL has expired.

**How it works**:
- Tags are assigned to tool calls via the DropQueue
- When cache TTL expires AND context pressure is sufficient, tags are marked for dropping
- In the `context` event, matching tool calls/results have their content stripped
- Placeholder message indicates the drop: "[DCP: deferred drop — cache expired]"

## Compression Priority Map

The `computePriorityMap()` function runs on every `context` event and classifies tool results by token size:

| Level | Tokens | Purpose |
|---|---|---|
| **high** | >5000 | Biggest compression targets — named in nudge messages |
| **medium** | 500-5000 | Secondary targets |
| **low** | <500 | Not worth individual compression |

The priority map is stored on the NudgeManager and included in nudge messages, so the model knows exactly which tool results to target for compression.

## Token Savings

All strategies report tokens saved:
- Check `/dcp` command for cumulative stats
- `total_auto_prunes`: number of items stripped
- `total_pruned_tokens`: estimated tokens saved
- Debug mode (`config.debug: true`) logs each action
