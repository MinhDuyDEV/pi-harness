# DCP Configuration Reference

Full configuration reference ported from the OpenCode DCP plugin. These settings control
context pruning behavior. In a pi skill context, use these as behavioral parameters.

## Default Configuration

```jsonc
{
  // Enable or disable context pruning behavior
  "enabled": true,

  // Notification level: "off", "minimal", or "detailed"
  "pruneNotification": "detailed",

  // Slash commands
  "commands": {
    "enabled": true,
    // Additional tools protected from command-based pruning
    "protectedTools": []
  },

  // Manual mode: disables autonomous context management
  "manualMode": {
    "enabled": false,
    // When true, auto-strategies still run even in manual mode
    "automaticStrategies": true
  },

  // Protect from pruning for N message turns past tool invocation
  "turnProtection": {
    "enabled": false,
    "turns": 4
  },

  // File operations protected from pruning via glob patterns
  "protectedFilePatterns": [],

  // Compress tool behavior settings
  "compress": {
    // Permission: "allow" (no prompt), "ask" (prompt), "deny" (disabled)
    "permission": "allow",
    // Show compression content in notification
    "showCompression": false,
    // Soft upper threshold for strong compression nudges
    "maxContextLimit": 100000,
    // Soft lower threshold — below this, nudges are off
    "minContextLimit": 30000,
    // How often the context-limit nudge fires (1 = every turn, 5 = every 5th)
    "nudgeFrequency": 5,
    // Start iteration nudges after this many messages without user input
    "iterationNudgeThreshold": 15,
    // "strong" = more likely to compress, "soft" = less likely
    "nudgeForce": "soft",
    // Tools whose outputs are always appended to compression summaries
    "protectedTools": ["task", "skill", "todowrite", "todoread"],
    // Preserve user messages verbatim during compression
    "protectUserMessages": false
  },

  // Automatic pruning strategies
  "strategies": {
    "deduplication": {
      "enabled": true,
      "protectedTools": []
    },
    "supersedeWrites": {
      "enabled": true
    },
    "purgeErrors": {
      "enabled": true,
      "turns": 4,
      "protectedTools": []
    }
  }
}
```

## Protected Tools (Always Protected)

These tools are always protected from pruning regardless of configuration:

| Tool          | Reason                                            |
| ------------- | ------------------------------------------------- |
| `task`        | Task tracking state                               |
| `skill`       | Skill loading records                             |
| `todowrite`   | Todo state management                             |
| `todoread`    | Todo state queries                                |
| `compress`    | Compression tool itself                           |
| `batch`       | Batch operation records                           |
| `plan_enter`  | Plan state transitions                            |
| `plan_exit`   | Plan state transitions                            |
| `write`       | File write operations (outputs protected)         |
| `edit`        | File edit operations (outputs protected)          |

## Protected File Patterns

Glob patterns for files whose tool operations should never be pruned:

```jsonc
"protectedFilePatterns": [
  ".env*",
  "AGENTS.md",
  ".pi/**",
  ".beads/**",
  "package.json",
  "tsconfig.json"
]
```

Pattern syntax:
- `*` — matches any characters except `/`
- `**` — matches any characters including `/` (zero or more directories)
- `?` — matches a single character except `/`

## Context Limit Configuration

| Setting           | Type              | Default  | Description                              |
| ----------------- | ----------------- | -------- | ---------------------------------------- |
| `maxContextLimit` | number or "N%"    | 100000   | Above this, critical nudges fire         |
| `minContextLimit` | number or "N%"    | 30000    | Below this, turn/iteration nudges are off|

When using percentage values (e.g., `"80%"`), the limit is calculated as a percentage of the
model's total context window.

## Per-Model Overrides

Different models can have different thresholds:

```jsonc
"compress": {
  "maxContextLimit": 100000,
  "modelMaxLimits": {
    "anthropic/claude-sonnet-4": "80%",
    "openai/gpt-4o": 120000
  },
  "modelMinLimits": {
    "anthropic/claude-sonnet-4": "25%"
  }
}
```

## Impact on Prompt Caching

LLM providers cache prompts based on exact prefix matching. When content is pruned, it
changes messages, which invalidates cached prefixes from that point forward.

**Trade-off**: You lose some cache reads but gain token savings from reduced context size
and fewer hallucinations from stale context. In most cases, especially in long sessions,
the savings outweigh the cache miss cost.

Approximate impact: ~85% cache hit rate with DCP vs ~90% without.

**No impact** for request-based billing (e.g., GitHub Copilot) or uniform token pricing
(e.g., Cerebras).
