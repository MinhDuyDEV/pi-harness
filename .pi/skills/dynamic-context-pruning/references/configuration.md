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
    "maxContextLimit": 150000,
    // Soft lower threshold — below this, nudges are off
    "minContextLimit": 50000,
    // How often the context-limit nudge fires (1 = every turn, 5 = every 5th)
    "nudgeFrequency": 5,
    // Start iteration nudges after this many messages without user input
    "iterationNudgeThreshold": 15,
    // "strong" = more likely to compress, "soft" = less likely
    "nudgeForce": "soft",
    // Tools whose outputs are always appended to compression summaries
    "protectedTools": ["task", "skill", "todowrite", "todoread"],
    // Preserve user messages verbatim during compression
    "protectUserMessages": false,
    // Compression mode: "range" (default) or "message" (experimental)
    "mode": "range",
    // Token budget for accumulated summaries (prevents nudge cascade)
    "summaryBuffer": 20000,
    // Simplified tool schema injection
    "flatSchema": false
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
  },

  // Experimental features
  "experimental": {
    // User-defined prompt override files
    "customPrompts": false,
    // Enable compression in sub-agent contexts
    "allowSubAgents": false
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
| `maxContextLimit` | number or "N%"    | 150000   | Above this, critical nudges fire         |
| `minContextLimit` | number or "N%"    | 50000    | Below this, turn/iteration nudges are off|

When using percentage values (e.g., `"80%"`), the limit is calculated as a percentage of the
model's total context window.

## Per-Model Overrides

Different models can have different thresholds:

```jsonc
"compress": {
  "maxContextLimit": 150000,
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

## New in v3.0.0+ Configuration Keys

These upstream config keys are documented for reference. All have typed defaults in pikit's
extension (`config.ts`). Keys marked with ★ are wired to runtime behavior; others are
declared for forward-compatibility but have no runtime consumer yet.

| Key | Type | Default | Since | Wired | Description |
|-----|------|---------|-------|-------|-------------|
| `manualMode.enabled` | bool | `false` | v3.0.0 | ★ | Disables autonomous compression; commands only |
| `manualMode.automaticStrategies` | bool | `true` | v3.0.0 | | Zero-cost strategies still run in manual mode |
| `turnProtection.enabled` | bool | `false` | v3.0.0 | | Protect content for N turns after tool invocation |
| `turnProtection.turns` | int | `4` | v3.0.0 | | Number of turns to protect |
| `compress.protectUserMessages` | bool | `false` | v3.0.0 | ★ | Prevents user messages from being compressed |
| `compress.flatSchema` | bool | `false` | v3.0.0 | | Simplified tool schema (reduces model confusion) |
| `compress.nudgeForce` | `"soft"\|"strong"` | `"soft"` | v3.0.0 | ★ | Compression aggressiveness after user messages |
| `compress.iterationNudgeThreshold` | int | `15` | v3.0.0 | ★ | Messages before iteration nudge fires |
| `experimental.customPrompts` | bool | `false` | v3.0.0 | | User-defined prompt override files |
| `experimental.allowSubAgents` | bool | `false` | v3.0.0 | ★ | Enable compression in sub-agent contexts |

## New in v3.1.0 Configuration Keys

| Key | Type | Default | Since | Description |
|-----|------|---------|-------|-------------|
| `compress.mode` | `"range"\|"message"` | `"range"` | v3.1.0 | Compression targeting mode. `"range"` collapses conversation ranges; `"message"` (experimental) compresses individual messages by size priority |
| `compress.summaryBuffer` | int | `20000` | v3.1.0 | Token budget for accumulated summaries. Prevents nudge cascade when summaries consume tokens. Nudges factor this in before firing |

### compress.mode Details

**"range" mode** (default): Select a conversation range by start/end boundaries. Best for clear
phase transitions (research done → implementation starting).

**"message" mode** (experimental): Compresses individual messages targeting the largest ones first
for maximum token recovery. Best for dense sessions without clear phase boundaries. Preserves
protected refs and completed compress calls. Uses stable IDs across multipart content.

### summaryBuffer Details

As compressions accumulate, the summaries themselves consume tokens. Without `summaryBuffer`,
the nudge system would keep firing even though the session *is* being managed — creating a
nudge cascade. The buffer tracks accumulated summary tokens and factors them into nudge decisions.

Default: 20,000 tokens. When summary tokens exceed this buffer, the system accounts for it
in the next nudge evaluation rather than treating all summary tokens as "recoverable" context.
