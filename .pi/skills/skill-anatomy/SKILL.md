---
name: skill-anatomy
description: 'Use when creating or editing a SKILL.md in this harness — reference spec for required frontmatter, section structure, the model-invocation opt-out, anti-rationalization tables, and context-efficiency rules.'
disable-model-invocation: true
---

# Skill anatomy

The contract every `SKILL.md` in this harness follows. Pi discovers skills by scanning `SKILL.md` files; this spec keeps them uniform, cheap to load, and honest under pressure.

## Frontmatter

| Field | Required | Notes |
|-------|----------|-------|
| `name` | yes | lowercase `a-z0-9-`; must match the directory name; no leading/trailing/double hyphen |
| `description` | yes | one paragraph; state WHEN to load it and when NOT (cheaper tool); this is what the model sees in `<available_skills>` |
| `disable-model-invocation` | no | `true` hides the skill from `<available_skills>` (reference-only; invoke via `/skill:name`). Use for niche/reference skills to respect the prompt budget |
| `metadata` | no | `category:` and `runtime:` (e.g. `node`) for tooling |

Pi reads only `name`, `description`, and the invocation opt-out. Any other top-level key is rejected by `validate:skills`.

## Sections (in order)

1. **What it's for** — one sentence problem statement.
2. **When to load / when not** — trigger conditions and the cheaper alternative.
3. **The workflow** — numbered steps the model follows.
4. **Anti-rationalization table** — the excuses the model will reach for, with the rebuttal. This is the load-bearing guard against skipping the workflow under time pressure.
5. **Examples / boundaries** — concrete in/out examples.

## Anti-rationalization table

Every skill that enforces a discipline should include a table of the common shortcuts and why they fail:

| Shortcut the model reaches for | Why it fails here |
|-------------------------------|-------------------|
| ... | ... |

Without this, the model rationalizes skipping the workflow the moment it feels confident. `agent-code-quality-gate`, `writing-skills`, `defense-in-depth`, and `source-driven-development` model this pattern; bring new skills up to that bar.

## Context efficiency

- Lead with the trigger; the model decides to load in one read of `description`.
- Keep the body under ~600 words; link out to deeper detail rather than inlining.
- No long rules duplicated from `AGENTS.md` / `APPEND_SYSTEM.md` — reference them, don't copy.
- One skill, one job; split when it grows a second purpose.

## Validate

`npm run validate:skills` checks frontmatter, name/dir match, body length, and per-skill hashes (`skills-lock.json`). After editing a skill, run `npm run regen:skills` to refresh the lock. The resource smoke enforces a prompt budget (model-visible skills ≤ 40, ≤ 8000 description chars) — gate new invocable skills with `disable-model-invocation: true` when they are reference-only.