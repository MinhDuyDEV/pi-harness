# DCP Strategies — Runtime-Enforced (v2)

> These strategies run automatically via the `context` event before every LLM call.
> No agent action required — they execute at the extension level.

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

## Token Savings

All strategies report tokens saved:
- Check `/dcp` command for cumulative stats
- `total_auto_prunes`: number of items stripped
- `total_pruned_tokens`: estimated tokens saved
- Debug mode (`config.debug: true`) logs each action
