# Automatic Pruning Strategies

These strategies run at zero LLM cost — they are behavioral patterns you should apply
automatically when managing context, without being asked.

## Strategy 1: Deduplication

**Rule**: When the same tool runs with the same arguments multiple times, only the most recent
output matters. Earlier duplicates can be discarded.

### How It Works

1. Track tool calls by signature: `toolName + normalized(parameters)`
2. When multiple calls share the same signature, keep only the most recent
3. Normalize parameters by removing undefined/null values and sorting keys

### Example

```
Turn 3: read("src/auth.ts")     → [content A]
Turn 7: read("src/auth.ts")     → [content B - file was modified]

→ Turn 3 output is stale. Only Turn 7 matters.
```

### Exceptions — Do NOT Deduplicate

- Protected tools: `task`, `skill`, `todowrite`, `todoread`, `compress`, `batch`
- Tools operating on protected file patterns
- Tools where parameter order or timing matters semantically

## Strategy 2: Supersede Writes

**Rule**: When a file is written and later read, the original write content is redundant because
the current file state is captured in the read result.

### How It Works

1. Track write operations by file path
2. Track read operations by file path
3. For each write, check if a subsequent read exists for the same file
4. If yes, the write's input content can be pruned (the read captured current state)

### Example

```
Turn 2: write("src/config.ts", content)  → wrote 50 lines
Turn 5: read("src/config.ts")            → shows current file state

→ Turn 2 write input is superseded. Turn 5 read has the authoritative content.
```

### Important Nuances

- Only prune write **inputs**, not the write confirmation output
- The read must come **after** the write chronologically
- Protected file patterns are excluded (`.env*`, `AGENTS.md`, etc.)
- Multiple writes to the same file: only the last one before a read is relevant

## Strategy 3: Purge Errors

**Rule**: After a configurable number of turns (default: 4), errored tool call inputs can be
stripped. The error message is preserved; only the potentially large input content is removed.

### How It Works

1. Track tool calls that resulted in errors
2. Count turns since each error occurred
3. After 4+ turns, strip the input content (replace with placeholder)
4. Keep the error message intact for debugging reference

### Example

```
Turn 3: write("src/bad-path.ts", [500 lines of code])  → ERROR: file not found
Turn 7: (current turn, 4 turns later)

→ Turn 3 input (500 lines) can be replaced with "[input removed due to failed tool call]"
→ The error message "file not found" is preserved
```

### Why This Matters

Errored tool calls often have large inputs (code to write, patches to apply) that consume
significant context. After enough turns, the detailed input is irrelevant — only the error
and the lesson matter.

### Exceptions

- Protected tools are excluded
- Protected file patterns are excluded
- Error messages are **never** removed, only inputs

## Applying Strategies

These strategies should be applied in this order:

1. **Deduplication** — recalculated when compress runs
2. **Supersede Writes** — recalculated when compress runs
3. **Purge Errors** — recalculated when compress runs

All strategies respect:

- Protected tool lists (tools that should never be pruned)
- Protected file patterns (glob patterns for files that should never be pruned)
- Turn protection (tools used within N recent turns are safe)

## Behavioral Application

Since these run as behavioral patterns (not code hooks), apply them when:

- You're about to compress a phase — check for dedup/supersede candidates first
- Context is growing and you're evaluating what to prune
- You notice repeated tool calls or stale write outputs in conversation history
- Error tool calls from several turns ago are consuming space

**Key insight**: These strategies are "free" — they don't require summarization quality.
They simply remove content that is provably redundant or stale.
