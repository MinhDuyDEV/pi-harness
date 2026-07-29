---
name: pi-harness-<name>
description: >-
  <Third-person description: what this skill does and the concrete situations
  that should trigger it. Keep under 1024 characters.>
metadata:
  version: 1.0.0
  tags:
    - <keyword>
  requires:
    anyBins:
      - node
---

# <Skill Title>

> <One-line outcome this skill produces.>

## User decisions

Inspect everything available before asking. When a material decision still blocks progress:

1. Prefer the loaded `ask_user` tool for one focused form. Combine only related choice/text questions, use stable ids and values, include a recommendation when evidence supports one, and wait for the result.
2. If `ask_user` is unavailable or the session is non-TUI, ask the same questions in one numbered plain-text message and wait.
3. Do not use a form for status updates, facts the repository can answer, or broad surveys.

## Scripts

Scripts live under this skill's `scripts/` directory. Resolve paths relative to this `SKILL.md`; never assume the consumer's working directory. Declare the real runtime in `metadata.requires` and invoke it directly—do not invent runtime placeholders or download a runtime implicitly.

| Script | Purpose |
| --- | --- |
| `scripts/main.mjs` | <Main operation> |
| `scripts/<util>.mjs` | <Optional utility> |

Example:

```bash
node {skillDir}/scripts/main.mjs --input <path> --output <path>
```

## Optional configuration

Configuration is optional unless this skill ships and documents a complete parser. Prefer sensible defaults. If configuration is needed:

- Project path: `.pi/skills/<skill-name>/config.md`
- Document its exact schema under `references/config/schema.md`.
- Read only documented keys; reject invalid values instead of guessing.
- Never store secrets in tracked project configuration.
- If required values are missing, collect only those values through the user-decision contract above, then ask before writing configuration.

Do not claim user-level overrides or environment-variable resolution unless the skill implements and tests them.

## Workflow

### Step 1: <Step name>

<Concrete action, inputs, and output.>

### Step N: Verify

<Name the smallest relevant check and inspect its result.>

## Output

| Artifact | Path | Description |
| --- | --- | --- |
| Final output | `<output-dir>/<file>` | <What it proves or contains> |

## References

| File | Content |
| --- | --- |
| `references/<file>.md` | <Why and when to load it> |
