---
name: customize-pi
version: 1.0.0
description: "Use when optimizing Pi configuration — settings.json tuning, provider setup, context window limits, compaction, keybindings, extensions, skills, packages, model cycling, or troubleshooting Pi behavior. Covers the full customization surface from quick tweaks to architecture decisions."
---

# Customize Pi

Optimize Pi for your hardware, models, and workflow. Every setting has a cost — tune for signal, not noise.

## Quick Decision Tree

```
What are you optimizing?
├─ Speed / cost        → Provider + model selection + thinking level
├─ Context longevity   → DCP + compaction + effective context windows
├─ Ergonomics          → Keybindings + theme + editor settings
├─ Capabilities        → Extensions + skills + packages
└─ Reliability         → Retry config + transport + timeout tuning
```

## Settings Files

| File                           | Scope   | Purpose                             |
| ------------------------------ | ------- | ----------------------------------- |
| `~/.pi/agent/settings.json`    | Global  | All projects default                |
| `.pi/settings.json`            | Project | Overrides global                    |
| `~/.pi/agent/keybindings.json` | Global  | Custom shortcuts                    |
| `~/.pi/agent/auth.json`        | Global  | API keys (auto-managed by `/login`) |

Project settings override global. Edit directly or use `/settings` in interactive mode.

## Provider & Model Setup

### Environment Variables

```bash
# Essential
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export DEEPSEEK_API_KEY=sk-...
export GEMINI_API_KEY=...
export XIAOMI_MIMO_API_KEY=...

# Or use /login for subscription providers (Codex, Claude Pro/Max, Copilot)
```

### Auth File (`~/.pi/agent/auth.json`)

```json
{
  "anthropic": { "type": "api_key", "key": "$ANTHROPIC_API_KEY" },
  "deepseek": { "type": "api_key", "key": "$DEEPSEEK_API_KEY" },
  "xiaomi": { "type": "api_key", "key": "$XIAOMI_MIMO_API_KEY" }
}
```

Supports: `$ENV_VAR`, `!command` (shell exec), literal values.

### Custom Context Windows (Critical for DCP)

**The problem:** Models advertise 1M context but degrade well before that. DCP calculates nudge thresholds against `model.contextWindow` — if you report the advertised max, nudges fire deep in the performance cliff.

**The fix:** Override `contextWindow` in provider definitions to report _effective_ limits:

| Model                 | Advertised | Effective | Why                                                         |
| --------------------- | ---------- | --------- | ----------------------------------------------------------- |
| DeepSeek V4 Pro/Flash | 1M         | 256K      | MRCR 8-needle stays >0.82 through 256K, drops to 0.59 at 1M |
| MiMo V2.5 / V2.5-Pro  | 1M         | 200K      | V2 Pro collapses to 0.00 at 1M on GraphWalks                |
| MiMo V2 Flash/Omni    | 256K       | 256K      | Already reasonable                                          |
| Claude Opus 4.6/4.7   | 1M         | 200K      | Multi-needle MRCR degrades past 200K                        |
| Gemini 3.1 Pro        | 1M         | 500K      | Only model whose 1M window holds for retrieval              |

**In your custom provider extension:**

```typescript
// Instead of:
contextWindow: 1_048_576,  // advertised 1M

// Use:
contextWindow: 262_144,    // 256K effective ceiling
```

**Research sources:** NVIDIA RULER, MRCR v2, NoLiMa, Chroma Context Rot, Ofox benchmarks.

### Thinking Levels

```json
{
  "defaultThinkingLevel": "high"
}
```

| Level             | Use When                           | Cost    |
| ----------------- | ---------------------------------- | ------- |
| `off` / `minimal` | Simple edits, known patterns       | Lowest  |
| `low`             | Quick tasks, exploration           | Low     |
| `medium`          | General coding, most tasks         | Medium  |
| `high`            | Complex reasoning, architecture    | High    |
| `xhigh`           | Maximum reasoning (DeepSeek "max") | Highest |

Per-model override via `/thinking` or `Shift+Tab` cycling.

### Custom Thinking Budgets

```json
{
  "thinkingBudgets": {
    "minimal": 1024,
    "low": 4096,
    "medium": 10240,
    "high": 32768
  }
}
```

## DCP (Dynamic Context Pruning)

DCP manages context pressure through compression, deduplication, and error purging.

### Default Config

```json
{
  "compress": {
    "minContextLimit": 65, // gentle nudge at 65% of context window
    "maxContextLimit": 80, // critical nudge at 80%
    "nudgeFrequency": 5, // nudge every 5 turns
    "summaryBuffer": 16384 // reserved summary tokens
  },
  "autoCompact": {
    "thresholdPercent": 80 // auto-compact at 80%
  }
}
```

### Tuning for Your Model

With effective context windows set correctly (see above), DCP nudges fire at useful thresholds:

| Model       | Effective Window | Gentle Nudge | Critical Nudge |
| ----------- | ---------------- | ------------ | -------------- |
| DeepSeek V4 | 256K             | ~166K tokens | ~205K tokens   |
| MiMo V2.5   | 200K             | ~130K tokens | ~160K tokens   |
| Claude Opus | 200K             | ~130K tokens | ~160K tokens   |

**Aggressive tuning** (compress earlier, keep context leaner):

```json
{
  "compress": {
    "minContextLimit": 50,
    "maxContextLimit": 65,
    "nudgeFrequency": 3
  }
}
```

**Conservative tuning** (use more context before compressing):

```json
{
  "compress": {
    "minContextLimit": 75,
    "maxContextLimit": 90,
    "nudgeFrequency": 8
  }
}
```

### Manual Compression

Use the `compress` tool (or `Shift+Tab` to access it) when a phase is complete:

```json
{
  "topic": "Auth System Exploration",
  "summary": "Exhaustive summary of findings...",
  "startId": "beginning of session",
  "endId": "after auth module implementation"
}
```

## Compaction

Auto-compaction triggers when: `contextTokens > contextWindow - reserveTokens`

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384, // tokens reserved for response
    "keepRecentTokens": 20000 // recent context kept verbatim
  }
}
```

**Tuning:**

- Increase `keepRecentTokens` if compaction loses too much recent work (default 20K)
- Decrease `reserveTokens` if responses are short and you want more context
- Set `enabled: false` if you prefer manual `/compact` control

## Keybindings

Create `~/.pi/agent/keybindings.json`:

```json
{
  "app.model.cycleForward": ["ctrl+p"],
  "app.model.cycleBackward": ["shift+ctrl+p"],
  "app.thinking.cycle": ["shift+tab"],
  "app.tools.expand": ["ctrl+o"],
  "app.message.followUp": ["alt+enter"],
  "app.session.tree": ["ctrl+shift+t"],
  "app.interrupt": ["escape"]
}
```

Run `/reload` after editing. Full action list at pi.dev/docs/latest/keybindings.

## Model Cycling

```json
{
  "enabledModels": ["mimo-v2.5*", "deepseek-v4-*", "claude-*"]
}
```

Cycle with `Ctrl+P` / `Shift+Ctrl+P`. Patterns support globs.

## Packages

Installed via `pi install` or declared in settings:

```json
{
  "packages": [
    "npm:@marckrenn/pi-sub-bar",
    "npm:@heyhuynhgiabuu/pi-diff",
    "git:github.com/user/repo@v1"
  ]
}
```

Object form for selective loading:

```json
{
  "packages": [
    {
      "source": "pi-skills",
      "skills": ["brave-search"],
      "extensions": []
    }
  ]
}
```

## Extensions

Auto-discovered from:

- `~/.pi/agent/extensions/*.ts` (global)
- `.pi/extensions/*.ts` (project)

Additional via settings:

```json
{
  "extensions": [".pi/extensions/"]
}
```

### Essential Extensions

| Extension           | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `dcp`               | Dynamic context pruning, compression, dedup      |
| `deepseek-provider` | DeepSeek V4 with thinking, repair, storm breaker |
| `mimo-provider`     | Xiaomi MiMo V2.5 models                          |
| `guard`             | Permission gates for dangerous commands          |
| `memory`            | Durable knowledge persistence                    |
| `srcwalk`           | Code navigation and analysis                     |

### Hot Reload

After editing extensions: `/reload` in interactive mode. No restart needed.

## Skills

Auto-discovered from:

- `~/.pi/agent/skills/` (global)
- `.pi/skills/` (project)

```json
{
  "skills": [".pi/skills/"],
  "enableSkillCommands": true
}
```

Load on-demand: `/skill:name` or let the agent auto-load when task matches description.

## Transport & Network

```json
{
  "transport": "sse",
  "httpIdleTimeoutMs": 300000,
  "websocketConnectTimeoutMs": 15000,
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000,
    "provider": {
      "timeoutMs": 3600000,
      "maxRetries": 0,
      "maxRetryDelayMs": 60000
    }
  }
}
```

**Transport options:** `"sse"` (default), `"websocket"`, `"websocket-cached"`, `"auto"`

**Tip:** Keep `retry.provider.maxRetries` at 0 unless provider-level retries are explicitly needed — SDK retries can mask quota exhaustion.

## UI & Display

```json
{
  "theme": "catppuccin",
  "quietStartup": false,
  "hideThinkingBlock": false,
  "editorPaddingX": 0,
  "autocompleteMaxVisible": 15,
  "doubleEscapeAction": "tree",
  "treeFilterMode": "default",
  "terminal": {
    "showImages": false,
    "showTerminalProgress": true,
    "clearOnShrink": true
  }
}
```

## Performance Profiles

### Minimal / Fast

For simple tasks, known patterns, quick edits:

```json
{
  "defaultThinkingLevel": "minimal",
  "compaction": { "reserveTokens": 8192, "keepRecentTokens": 10000 },
  "transport": "sse"
}
```

### Balanced / Default

General coding, most sessions:

```json
{
  "defaultThinkingLevel": "medium",
  "compaction": { "reserveTokens": 16384, "keepRecentTokens": 20000 },
  "retry": { "maxRetries": 3 }
}
```

### Heavy / Long Sessions

Architecture, multi-file refactors, long agent loops:

```json
{
  "defaultThinkingLevel": "high",
  "compaction": { "reserveTokens": 16384, "keepRecentTokens": 32768 },
  "retry": { "maxRetries": 5, "baseDelayMs": 3000 }
}
```

### Cost-Optimized

Minimize token spend:

```json
{
  "defaultThinkingLevel": "low",
  "hideThinkingBlock": true,
  "compaction": { "keepRecentTokens": 12000 }
}
```

## Common Issues

| Symptom                        | Fix                                                          |
| ------------------------------ | ------------------------------------------------------------ |
| Context fills too fast         | Set effective contextWindow, tune DCP min/max                |
| Model ignores old context      | Lower `minContextLimit` to compress earlier                  |
| Compaction loses recent work   | Increase `keepRecentTokens`                                  |
| Slow responses                 | Lower thinking level, switch to Flash/cheaper model          |
| Rate limit errors              | Increase `retry.baseDelayMs`, add `maxRetryDelayMs`          |
| Extensions not loading         | Check `.pi/extensions/` path, run `/reload`                  |
| Skills not appearing           | Check `.pi/skills/` path, verify `enableSkillCommands: true` |
| Model not in cycle             | Add pattern to `enabledModels`                               |
| Thinking blocks clutter output | Set `hideThinkingBlock: true`                                |

## Reference

- Full settings: pi.dev/docs/latest/settings
- Extensions API: pi.dev/docs/latest/extensions
- Providers: pi.dev/docs/latest/providers
- Keybindings: pi.dev/docs/latest/keybindings
- Skills: pi.dev/docs/latest/skills
- Compaction: pi.dev/docs/latest/compaction
