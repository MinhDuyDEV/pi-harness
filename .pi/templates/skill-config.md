---
name: pi-harness-skill-config
description: >-
  Reference schema for pi-harness skill config.md files. Defines the layered
  config convention with project-level and user-level paths, first-time
  setup flow, and standard preference keys.
version: 1.0.0
---

# Pi-harness Skill Config Convention

Based on baoyu-skills EXTEND.md pattern, adapted for the Pi agent ecosystem.

## Layered Config Resolution

Every pi-harness skill that needs configuration resolves its config.md in priority order.
First hit wins. If higher-priority path exists, lower-priority paths are never read.

### Priority 1: Project-Level

**Path**: `.pi/skills/<skill-name>/config.md`

Lives alongside the skill's `SKILL.md` in the project tree. Version-controlled with the skill itself — good for team-shared defaults.

**Convention**: Ship a `config.md` with your skill if it has sensible defaults. The SKILL.md's first-time setup only triggers if this file is missing.

### Priority 2: User-Level

**Path**: `~/.pi/agent/config/skills/<skill-name>.md`

The user's personal override. Not version-controlled. Survives pi-harness updates. Add to `.gitignore` if it contains secrets.

**Env override**: If `PI_HARNESS_CONFIG_DIR` env var is set, it replaces `~/.pi/agent/config/` as the user-level root.

## Config File Format

Config files are Markdown with YAML frontmatter sections. Top-level keys are section headers (`## Key`) with YAML or key-value lists underneath.

```markdown
---
name: <skill-name>
version: 1.0.0  # config schema version
---

## <section>
key: value
another_key: 42

## <another_section>
- item1
- item2
```

**Rules**:
- Section headers (`## Key`) are the top-level config namespaces
- Under each section, use YAML-like `key: value` pairs or lists
- Strings, numbers, booleans, and arrays are supported
- Comments: lines starting with `#` are ignored
- Encoding: UTF-8

## Schema Reference Template

Every configurable skill MUST include a schema reference at `references/config/schema.md` documenting:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `key` | string | `default` | What it controls |
| `mode` | enum | `auto` | Allowed: `auto`, `ask`, or a skill-specific value |

## First-Time Setup (BLOCKING)

When config.md is not found at any priority level, the SKILL.md workflow **blocks** at Step 0 and runs first-time setup:

1. Collect ALL required preferences via `AskUserQuestion` in ONE batch
2. Save to project-level path (`.pi/skills/<skill>/config.md`)
3. Confirm to user: "Preferences saved to [path]"
4. Continue to Step 1

**Do not silently use defaults. Do not skip setup.**

## Standard Preference Keys

These keys are shared across all pi-harness skills. Skill-specific keys go in the skill's own schema.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `preferred_output_dir` | string | `<skill>/<topic>/` | Output directory for generated files |
| `verbose` | boolean | `false` | Enable detailed logging |
| `max_workers` | number | `4` | Parallel worker count for subagent tasks |
| `chunk_threshold` | number | `4000` | Word count at which chunked parallel mode activates |

## Example: translate Skill Config

```markdown
---
name: pi-harness-translate
version: 1.0.0
---

## preferences
target_language: zh-CN
default_mode: normal
audience: general
style: storytelling
chunk_threshold: 4000
chunk_max_words: 5000
verbose: false

## glossary
# Technical terms specific to this project
API: 应用程序接口
latency: 延迟
throughput: 吞吐量
```
