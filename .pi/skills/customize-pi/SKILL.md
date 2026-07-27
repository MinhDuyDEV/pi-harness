---
name: customize-pi
description: >-
  Configures the Pi coding agent — settings.json (model, compaction, packages, resource paths),
  models.json custom providers, keybindings.json, extensions, and skills. User-invoked: load via
  /skill:customize-pi when tuning Pi configuration, adding providers or packages, or troubleshooting
  why a setting, skill, or extension is not applied.
metadata:
  version: 1.1.0
disable-model-invocation: true
---

# Customize Pi

## Iron Laws

- **Settings before extensions.** Most tweaks are `settings.json`, not code.
- **One change at a time, test, commit.** Config errors are silent and compounding.
- **Document the WHY** next to the change, not just the value.
- **Backup before bulk changes.** `cp settings.json settings.json.bak`.
- **Only use settings that exist.** The source of truth is `Settings` in the Pi SDK (`@earendil-works/pi-coding-agent`, `core/settings-manager.d.ts`) and the bundled `docs/settings.md`.

## Settings Locations

```
~/.pi/agent/settings.json     global (all projects)
<project>/.pi/settings.json   project (overrides global)
```

Edit directly or use `/settings` for common options. Project resources load only for trusted projects (`/trust`; fallback behavior via global `defaultProjectTrust`: `ask` | `always` | `never`).

## Key Settings (verified)

| Setting | What |
|---|---|
| `defaultProvider` / `defaultModel` | Pin provider + model per scope |
| `defaultThinkingLevel` | `off`–`max`; budgets tunable via `thinkingBudgets` |
| `enabledModels` | Patterns limiting which models appear |
| `compaction` | `{ enabled, reserveTokens, keepRecentTokens }` |
| `branchSummary` | `{ reserveTokens, skipPrompt }` |
| `retry` | `{ enabled, maxRetries, baseDelayMs, provider }` |
| `packages` | npm/git package sources (`npm:...`, `git:...`) |
| `extensions` / `skills` / `prompts` / `themes` | Local resource paths (string arrays) |
| `enableSkillCommands` | Expose skills as `/skill:<name>` commands |
| `theme`, `quietStartup`, `terminal`, `images` | UI/display preferences |

There is no `maxContextTokens` or `compactionThreshold` setting — context handling is controlled by the `compaction` object above.

## Models & Providers

- Switch models with `/model`; pin per project via `defaultModel`/`defaultProvider` in `.pi/settings.json`.
- Custom providers (Ollama, vLLM, proxies) go in `~/.pi/agent/models.json`; it reloads each time `/model` opens — no restart needed.

## Context & Compaction

- Auto-compaction summarizes old messages when the context nears the model window; tune `reserveTokens` (space kept for output) and `keepRecentTokens` (recent messages kept verbatim).
- Trigger manually with `/compact [instructions]` — optional instructions focus the summary.
- Re-read the summary after compacting to verify nothing important was lost.

## Packages, Extensions, Skills

- `packages` entries can be filtered: `{ "source": "npm:...", "skills": [...], "extensions": [...], "autoload": false }`.
- Skills auto-load from `.pi/skills/`; each needs `name` + `description` frontmatter. `disable-model-invocation: true` hides a skill from automatic loading (user-invoked only); `allowed-tools` is experimental. Skill descriptions are tokens — keep them tight.
- Test extension impact on context size; large extensions eat tokens.

## Keybindings

Live in `~/.pi/agent/keybindings.json` (NOT settings.json), keyed by namespaced action ids. Apply with `/reload`; see the Pi keybindings doc for ids and key format.

## Red Flags

Inventing settings not in the SDK `Settings` type; bulk changes without backup; undocumented tweaks; project settings silently overriding user defaults; keybindings placed in settings.json; skill description too vague or too broad; "let me try five settings at once" (one at a time); fighting the system instead of changing workflow.
