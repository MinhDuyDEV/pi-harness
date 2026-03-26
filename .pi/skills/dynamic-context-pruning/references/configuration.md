# DCP Configuration Reference

Full configuration reference ported from the OpenCode DCP plugin. These settings control
context pruning behavior. In a pi skill context, use these as behavioral parameters.

## Default Configuration

```jsonc
{
  // Enable or disable the DCP extension
  "enabled": true,

  // Notification verbosity for extension-owned status output
  "pruneNotification": "detailed",

  // File operations protected from pruning via glob patterns
  "protectedFilePatterns": [
    ".env*",
    "AGENTS.md",
    ".pi/**",
    ".beads/**",
    "package.json",
    "tsconfig.json"
  ],

  // Compress tool behavior settings
  "compress": {
    // Permission: "allow" (no prompt), "ask" (confirm in UI), "deny" (disabled)
    "permission": "allow",
    // Soft upper threshold for strong compression nudges (behavioral in Pi port)
    "maxContextLimit": 150000,
    // Soft lower threshold — below this, nudges are off (behavioral in Pi port)
    "minContextLimit": 50000,
    // How often the context-limit nudge fires (behavioral in Pi port)
    "nudgeFrequency": 5,
    // Start iteration nudges after this many messages without user input
    "iterationNudgeThreshold": 15,
    // "strong" = more likely to compress, "soft" = less likely
    "nudgeForce": "soft",
    // Tools whose outputs are always protected from pruning/compression
    "protectedTools": ["task", "skill", "todowrite", "todoread", "observation"],
    // Preserve user messages verbatim during compression (behavioral in Pi port)
    "protectUserMessages": false,
    // Compression mode: "range" (default) or "message" (advisory in Pi port)
    "mode": "range",
    // Token budget for accumulated summaries
    "summaryBuffer": 20000,
    // Simplified tool schema injection (declared for compatibility only)
    "flatSchema": false
  },

  // Automatic pruning strategies
  "strategies": {
    "deduplication": {
      "enabled": true,
      // Runtime-wired: merged with compress.protectedTools before tracking duplicates
      "protectedTools": []
    },
    "supersedeWrites": {
      "enabled": true
    },
    "purgeErrors": {
      "enabled": true,
      "turns": 4,
      // Behavioral only in the Pi port
      "protectedTools": []
    }
  },

  // Manual mode / turn protection / experimental flags are kept for
  // compatibility with upstream mental models. In the Pi port they are
  // behavioral guidance unless explicitly marked runtime-wired below.
  "manualMode": {
    "enabled": false,
    "automaticStrategies": true
  },
  "turnProtection": {
    "enabled": false,
    "turns": 4
  },
  "experimental": {
    "customPrompts": false,
    "allowSubAgents": false
  }
}
```

## Compression Permission

| Value | Runtime behavior |
| ----- | ---------------- |
| `"allow"` | Register the `compress` tool and run immediately |
| `"ask"` | Register the `compress` tool and prompt for confirmation when UI is available |
| `"deny"` | Do not register the `compress` tool |

If `permission` is `"ask"` and no UI is available, the tool returns an error instead of compressing silently.

## Strategy Runtime Support

| Setting | Runtime | Notes |
| ------- | ------- | ----- |
| `strategies.deduplication.enabled` | extension | Enables tool-call tracking for duplicate detection |
| `strategies.deduplication.protectedTools` | extension | Merged with `compress.protectedTools` before dedup tracking |
| `strategies.supersedeWrites.enabled` | skill | Behavioral guidance only |
| `strategies.purgeErrors.enabled` | skill | Behavioral guidance only |
| `strategies.purgeErrors.turns` | skill | Behavioral guidance only |
| `strategies.purgeErrors.protectedTools` | skill | Behavioral guidance only |

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

| Setting           | Type   | Default | Runtime | Description |
| ----------------- | ------ | ------- | ------- | ----------- |
| `maxContextLimit` | number | 150000  | skill   | Above this, critical nudges fire |
| `minContextLimit` | number | 50000   | skill   | Below this, turn/iteration nudges are off |
| `nudgeFrequency`  | number | 5       | skill   | How often context-limit nudges fire |

In the Pi port, these thresholds are **behavioral guidance for the agent skill**, not hard runtime
limits enforced by the extension code.

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

These upstream config keys are documented for reference. In the Pi port, some are consumed by the
extension runtime, while others are kept only to preserve the upstream mental model used by the
skill.

| Key | Type | Default | Since | Runtime | Description |
|-----|------|---------|-------|---------|-------------|
| `manualMode.enabled` | bool | `false` | v3.0.0 | skill | Disables autonomous compression behavior in the skill; does **not** unregister the `compress` tool |
| `manualMode.automaticStrategies` | bool | `true` | v3.0.0 | skill | Zero-cost strategies still run in manual mode |
| `turnProtection.enabled` | bool | `false` | v3.0.0 | declared | Protect content for N turns after tool invocation |
| `turnProtection.turns` | int | `4` | v3.0.0 | declared | Number of turns to protect |
| `compress.protectUserMessages` | bool | `false` | v3.0.0 | skill | Preserve user messages verbatim during compression summaries |
| `compress.flatSchema` | bool | `false` | v3.0.0 | declared | Simplified tool schema (reduces model confusion) |
| `compress.nudgeForce` | `"soft"\|"strong"` | `"soft"` | v3.0.0 | skill | Compression aggressiveness after user messages |
| `compress.iterationNudgeThreshold` | int | `15` | v3.0.0 | skill | Messages before iteration nudge fires |
| `experimental.customPrompts` | bool | `false` | v3.0.0 | declared | User-defined prompt override files |
| `experimental.allowSubAgents` | bool | `false` | v3.0.0 | declared | Reserved for future subagent-specific behavior |

## New in v3.1.0 Configuration Keys

| Key | Type | Default | Since | Runtime | Description |
|-----|------|---------|-------|---------|-------------|
| `compress.mode` | `"range"\|"message"` | `"range"` | v3.1.0 | extension + skill | Compression targeting mode. `"range"` collapses conversation ranges; `"message"` is **advisory in the Pi port** and records that the agent selected message-sized slices before summarizing |
| `compress.summaryBuffer` | int | `20000` | v3.1.0 | extension | Token budget for accumulated summaries. Prevents nudge cascade when summaries consume tokens |

### compress.mode Details

**"range" mode** (default): Select a conversation range by start/end boundaries. Best for clear
phase transitions (research done → implementation starting).

**"message" mode** (experimental, advisory in the Pi port): The agent should choose message-sized
slices by priority when planning the summary. The current Pi extension still stores a normal
compression block using the provided `startId`, `endId`, and `summary`; it does not auto-select
messages for you.

### summaryBuffer Details

As compressions accumulate, the summaries themselves consume tokens. Without `summaryBuffer`,
status and planning logic can treat all accumulated summary tokens as free savings, which creates
misleading pressure to keep compressing. The buffer tracks accumulated summary tokens explicitly.

Default: 20,000 tokens. In the Pi port this value is surfaced in the tool response and `/dcp`
status output so the agent can reason about summary overhead during future compression decisions.
