---
name: customize-pi
version: 1.0.0
description: "Use when optimizing Pi configuration — settings.json tuning, provider setup, context window limits, compaction, keybindings, extensions, skills, packages, model cycling, or troubleshooting Pi behavior. Covers the full customization surface from quick tweaks to architecture decisions."
---

# Customize Pi

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Settings before extensions.** Most tweaks are `settings.json`, not code.
- **One change at a time, test, commit.** Silent + compounding.
- **Document the WHY.** "Set to 8000 because codebase has 5K-context modules" — not "set to 8000".
- **Don't fight the system.** Awkward setting → change workflow first.
- **Backup before bulk changes.** `cp settings.json settings.json.bak`.
</EXTREMELY-IMPORTANT>

## Settings Locations

```
~/.pi/                          user config (all projects)
<project>/.pi/                  project config (overrides user)
```

Project settings take precedence. Use for project-specific (model, context limit); use user settings for personal prefs (keybindings, theme).

## Key Settings

| Setting | Default | When to change |
|---|---|---|
| `model` | "default" | Switch provider or model |
| `maxContextTokens` | varies | Match your model's window |
| `compactionThreshold` | 0.8 | Lower for chatty sessions |
| `theme` | "default" | Visual preference |
| `extensions` | [] | Per-project extension loading |
| `skills` | [] | Per-project skill loading |
| `keybindings` | {} | Custom shortcuts |

## Model Selection

- **Reasoning-heavy tasks** (debugging, architecture): opus, sonnet, deepseek-reasoner
- **Code generation**: sonnet, gpt-4o, deepseek-coder
- **Fast iteration**: haiku, gpt-4o-mini
- **Long context (100K+)**: claude, gpt-4-turbo, gemini-pro

Cycle with `/model` or in settings. Pin a model per project to avoid surprise.

## Context Window

- Set `maxContextTokens` to 80% of model window (leave room for output).
- Compact at 0.8 threshold by default; lower to 0.6 for chatty sessions.
- Manual compact: `/compact <focus>` before long tasks.
- For very long sessions: `/clear` and resume with summary.

## Compaction

- Auto-compact keeps recent messages + a summary of older ones.
- Tune with `/compact` directives: "preserve code blocks", "summarize decisions, keep verbatim quotes".
- Re-read the summary after compact to verify nothing important was lost.

## Extensions

- Load via `extensions: ["./extensions/"]` in settings.
- Auto-loaded by directory; per-project via `.pi/extensions/`.
- Test extension impact on context size — large extensions eat tokens.

## Skills

- Auto-loaded by directory: `.pi/skills/`.
- Skill descriptions are tokens; tighten them (P2 lesson).
- `agent_types` controls which agents see the skill.
- `tools` declares required tools; missing tool = skill won't load.

## Keybindings

```json
{
  "keybindings": {
    "ctrl+enter": "submit",
    "ctrl+k": "command-palette",
    "ctrl+l": "clear-screen"
  }
}
```

Reference the Pi keybinding docs for available actions.

## Common Mistakes

Editing without restart; bulk changes without backup; context too high (truncation); wrong model; extension breaking context; skill triggering too often; keybinding conflict; project overwriting user default; mixing user/project settings; undocumented changes.

## Red Flags

Uncommented experimental flags; no backup; model/context mismatch; "let me try" without commit; extension on every keystroke; skill too vague or too narrow; keybinding fails in some terminals; change without restart silently fails.

## Anti-Patterns

**Tweak every setting** (one at a time); **no backup** (always); **undocumented** (document WHY); **fighting the system** (change workflow first).
