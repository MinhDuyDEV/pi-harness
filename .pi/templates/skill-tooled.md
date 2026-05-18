---
name: pikit-<name>
description: >-
  <Third-person description. What it does + when an agent should invoke it.
  Must include trigger keywords for automatic invocation. Max 1024 chars.>
version: 1.0.0
tags: [<comma-separated keywords>]
agent_types: [planner, worker, reviewer]
metadata:
  requires:
    anyBins:
      - bun
      - npx
---

# <Skill Title>

> <One-line summary of the skill's purpose and outcome.>

## User Input Tools

When this skill prompts the user, follow this tool-selection rule (priority order):

1. **Prefer built-in user-input tools** exposed by the current agent runtime — e.g., Pi `AskUserQuestion`, Codex `clarify`, or any equivalent.
2. **Fallback**: if no such tool exists, emit a numbered plain-text message and ask the user to reply with the chosen number/answer for each question.
3. **Batching**: if the tool supports multiple questions per call, combine all applicable questions into a single call; if only single-question, ask them one at a time in priority order.

Concrete `AskUserQuestion` references below are examples — substitute the local equivalent in other runtimes.

## Script Directory

**Important**: All scripts are located in the `scripts/` subdirectory of this skill.

**Agent Execution Instructions**:
1. Determine this SKILL.md file's directory path as `{baseDir}`
2. Script path = `{baseDir}/scripts/<script-name>.ts`
3. Resolve `${BUN_X}` runtime:
   - If `bun` installed → `bun`
   - If `npx` available → `npx -y bun`
   - Else suggest `brew install oven-sh/bun/bun` or `npm install -g bun`
4. Replace all `{baseDir}` and `${BUN_X}` in this document with actual values

**Script Reference**:

| Script | Purpose |
|--------|---------|
| `scripts/main.ts` | Main entry point |
| `scripts/<util>.ts` | <Utility description> |

## Step 0: Load Preferences ⛔ BLOCKING

This step MUST complete before proceeding — execution is blocked until preferences are loaded.

### Config Paths (priority order)

Check these paths in order; first hit wins. If env var `PIKIT_CONFIG_DIR` is set, it overrides user-level path resolution.

| Priority | Path | Scope |
|----------|------|-------|
| 1 | `.pi/skills/<skill-name>/config.md` | Project (lives alongside SKILL.md) |
| 2 | `~/.pi/agent/config/skills/<skill-name>.md` | User home |

### On Found

- Read, parse, apply settings
- On first use in session, briefly remind: "Using preferences from [path]. You can edit config.md to customize [key options]."

### On Not Found

**Must** run first-time setup (see below) — do NOT silently use defaults.

### First-Time Setup (BLOCKING)

When config.md is not found, you **MUST** run first-time setup before ANY work. This is a **BLOCKING** operation.

Collect ALL required preferences via `AskUserQuestion` in ONE call (batch all questions). After user answers, save config.md to the chosen location, confirm "Preferences saved to [path]", then continue.

### Config Schema

See `references/config/schema.md` for full schema.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `key` | string | `default` | Description |
| `key2` | number | `42` | Description |

## Workflow

### Step 1: <Step Name>

<What the agent does in this step. Include file outputs if applicable.>

```
# Example script invocation
${BUN_X} {baseDir}/scripts/main.ts --input <path> --output <path>
```

### Step N: <Step Name>

<Continue with steps. Each step should produce a concrete output (file, decision, or next-state).>

### Step N+1: Verify

<Verification step — run a check, test, or validation.>

```
<verification command>
```

## Output

<Describe what the skill produces.>

| Artifact | Path | Description |
|----------|------|-------------|
| Final output | `<output-dir>/<file>` | Description |

## References

| File | Content |
|------|---------|
| `references/<file>.md` | <What this reference contains> |

## Extension Support

Custom configurations via config.md. See **Step 0** for paths and supported options.
