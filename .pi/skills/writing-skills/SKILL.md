---
name: writing-skills
description: "Use when creating new skills, editing existing skills, or verifying skills work before deployment - applies TDD to process documentation by testing with subagents before writing, iterating until bulletproof against rationalization. Includes complete pressure testing methodology."
version: 1.0.0
tags: [documentation, workflow]
dependencies: []
agent_types: [planner, worker, reviewer]
tools: []
---

# Writing Skills

## The Iron Law (Same as TDD)

<EXTREMELY-IMPORTANT>
**NO SKILL WITHOUT A FAILING TEST FIRST.** A skill is a *behavior change* in the agent that loads it. Test the behavior, not the prose.
</EXTREMELY-IMPORTANT>

**REQUIRED BACKGROUND:** test-driven-development.

## Why This Is Hard

The "test" (run a subagent) is expensive; the rationalization is "obviously correct".

## The Loop

```
RED:      subagent WITHOUT skill — watch it fail
GREEN:    smallest skill that flips the failure
REFACTOR: close loopholes the test exposed
```

A "test" is a pressure scenario (prompt to make the agent skip the iron law) plus a rubric.

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

Form must match the failure. A misformed rule is noise.

## Workflow

1. **Gap.** What skill *would have* prevented the observed bad behavior?
2. **RED** — scenario, subagent *without* skill. Score. Record.
3. **GREEN** — minimum skill that flips the failure. Re-run. Iterate.
4. **REFACTOR** — adversarial prompts. Skill must hold.
5. **Compress.** Pass → tighten. Compressed skills that pass are load-bearing.
6. **Commit + index.** Reference in `superpi` if in "skills you reach for first".

## Pressure-Testing Scenarios

| Type | What it tests |
| --- | --- |
| **Skipping iron law** | "I'm in a hurry, just give me the answer." |
| **Rationalization** | "I know the rule, this is obvious." |
| **Edge case** | "My case is special." |
| **Compression** | After compression, does the agent still apply? |
| **Cross-skill** | Two skills in tension. Which wins? |

## Rubric Template

```
Score: /5 — iron law (1), workflow (0–3), red flags (1), contract (1), refused to skip (1). Pass: 4/5, two consecutive.
```

## Skill Anatomy

```
---
name: <kebab>
description: Use when <triggering condition>...
---
# <Title>
## Core Principle | When to Use / NOT | Workflow | Red Flags | Anti-Patterns | Contract
```

Target: <500 words.

## HARD-GATE Markers

Use `<HARD-GATE>` / `<EXTREMELY-IMPORTANT>` when the agent has skipped the rule.

## Red Flags (Writing the Skill)

Wrote before RED; "obviously correct" with no test; description too vague or too long; iron law missing where the agent skips; compression deleted a load-bearing marker; contract is boilerplate.

## Anti-Patterns

**The "obvious" skill** (untested); **the bible** (cannot load); **the summarizer** (rephrases AGENTS.md); **the tutorial** (move to docs).

## Skill Result Contract

```
<skill_result>
  <skill>writing-skills</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>RED scenario, GREEN skill, REFACTOR</evidence>
  <artifacts>Scenario + rubric + skill</artifacts>
  <risks>Untested, regressed marker, or none</risks>
</skill_result>
```
