---
name: writing-skills
description: TDD for process documentation — creating, editing, and pressure-testing skills, plus the anatomy spec for every SKILL.md. Use when writing a new skill, editing one, or checking it against the validator.
metadata:
  version: 2.0.0
  tags:
  - documentation
  - workflow
  dependencies: []
---

# Writing Skills

## The Iron Law (Same as TDD)

<EXTREMELY-IMPORTANT>
**NO SKILL WITHOUT A FAILING TEST FIRST.** A skill is a *behavior change* in the agent that loads it. Test the behavior, not the prose.
</EXTREMELY-IMPORTANT>

**REQUIRED BACKGROUND:** test-driven-development.

## The Loop

```
RED:      subagent WITHOUT skill — watch it fail
GREEN:    smallest skill that flips the failure
REFACTOR: close loopholes the test exposed
```

A "test" is a pressure scenario (a prompt that tempts the agent to skip the rule) plus a rubric. Full methodology: [references/testing-methodology.md](references/testing-methodology.md); scenario design per skill type: [references/testing-skill-types.md](references/testing-skill-types.md).

## Match the Form to the Failure

<EXTREMELY-IMPORTANT>
**Prohibitions backfire on shaping problems.** A "don't do X" rule suppresses a desired output without teaching the correct one. Use a recipe.
</EXTREMELY-IMPORTANT>

| Baseline failure | Right form | Wrong form |
| --- | --- | --- |
| Skips test | Recipe (RED→GREEN→REFACTOR) | "Always write tests" |
| Oversizes diff | Delete-list | "Keep it small" |
| Unverified claim | Verification template + `<evidence>` | "Verify your work" |
| Guesses under uncertainty | Variants + interview | "Ask if unsure" |

## Workflow

1. **Gap.** What skill *would have* prevented the observed bad behavior?
2. **RED** — scenario, subagent *without* skill. Score. Record.
3. **GREEN** — minimum skill that flips the failure. Re-run. Iterate.
4. **REFACTOR** — adversarial prompts ([references/rationalization-hardening.md](references/rationalization-hardening.md)). Skill must hold.
5. **Compress.** Pass → tighten. Compressed skills that pass are load-bearing.
6. **Validate + commit.** `npm run validate:skills`, then `npm run regen:skills` to refresh `skills-lock.json`.

Pressure types: skipping the iron law under time pressure, "this case is special", post-compression re-test, two skills in tension. Rubric: score /5 — iron law, workflow, red flags, contract, refused to skip; pass = 4/5 twice consecutively.

## Anatomy Spec

The single source of truth for `SKILL.md` structure, matching `scripts/validate-skills.mjs`:

| Frontmatter key | Rule |
|---|---|
| `name` | required; must equal the directory name |
| `description` | required; third person; first sentence = what, rest = concrete triggers; searchable names > vague ones ([references/claude-search-optimization.md](references/claude-search-optimization.md)) |
| `disable-model-invocation` | optional; `true` hides the skill from the model (user-invoked via `/skill:name`) |
| `metadata` | optional; `version` / `tags` / `dependencies` |

Any other top-level key is rejected by `validate:skills`. Body limit: **600 words target, 700 hard cap** (validator-enforced, frontmatter excluded). Prompt budget: ≤40 model-visible skills, ≤8000 total description chars — hide reference-only skills. One skill, one job; push depth into linked `references/` files ([references/file-organization.md](references/file-organization.md)); never leave them unlinked. Use `<HARD-GATE>` / `<EXTREMELY-IMPORTANT>` only where an agent has actually skipped the rule. Diagram conventions: [references/graphviz-conventions.dot](references/graphviz-conventions.dot) with [references/flowcharts-and-examples.md](references/flowcharts-and-examples.md); persuasion research behind pressure-testing: [references/persuasion-principles.md](references/persuasion-principles.md); finding gaps worth a skill: [references/discovery-workflow.md](references/discovery-workflow.md).

## Anti-rationalization

| Shortcut the model reaches for | Why it fails here |
|---|---|
| "The skill is obviously correct" | The test is a subagent run, not your confidence; obvious skills fail RED runs constantly. |
| "Testing is expensive, skip it" | An untested skill ships a behavior bug into every future session that loads it. |
| "I'll compress and trust the diff" | Compression deletes load-bearing markers; re-run the pressure scenario after. |

## Red Flags

Wrote the skill before a RED baseline run; description vague or workflow-summarizing (the agent follows the summary instead of the body); iron law missing where the agent demonstrably skips; compression deleted a load-bearing marker; a skill that rephrases AGENTS.md; a bible no one can load; a tutorial that belongs in docs; anti-pattern catalog: [references/anti-patterns.md](references/anti-patterns.md).
