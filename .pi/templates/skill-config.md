---
name: pi-harness-skill-config
description: >-
  Optional reference for skills that implement and test project-local Markdown
  configuration. Use only when defaults are insufficient.
metadata:
  version: 1.1.0
  tags:
    - skill-authoring
    - configuration
---

# Optional Skill Configuration

This is an authoring pattern, not an ambient pi-harness runtime service. A skill must not claim config discovery, parsing, validation, or overrides unless it implements and tests those behaviors.

## Project-local path

Use `.pi/skills/<skill-name>/config.md` for non-secret project preferences. A configurable skill should ship sensible defaults and continue without creating this file whenever possible.

Do not invent a user-level path or environment override. If a skill needs either, define the contract in that skill, implement it, and add focused precedence tests.

## Format

Choose one documented format and parse it strictly. This Markdown example uses YAML frontmatter:

```markdown
---
schema-version: 1
output-dir: docs/generated
verbose: false
---
```

Every key needs a type, default, valid range, and compatibility rule in `references/config/schema.md`. Unknown or invalid values must produce a clear error rather than silently changing behavior. Never put credentials in tracked configuration.

## Missing required values

Inspect repository evidence first. If a required preference remains unknown, prefer one focused `ask_user` form, combine related choice/text questions, and wait for the answer. If `ask_user` is unavailable or the session is non-TUI, ask the same questions in one numbered plain-text message and wait.

Ask before writing a new config file. Do not block on optional preferences that have documented safe defaults.

## Reference checklist

- [ ] The skill owns a real parser and focused tests.
- [ ] The config path and precedence are exact.
- [ ] Defaults are documented and safe.
- [ ] Invalid and unknown keys are handled explicitly.
- [ ] Secrets are forbidden from tracked files.
- [ ] Interactive setup has a numbered plain-text fallback.
