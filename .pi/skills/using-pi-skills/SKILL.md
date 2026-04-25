---
name: using-pi-skills
description: Guides Pi agents in selecting, invoking, and completing skills with evidence. Use when starting a session, mapping user intent to workflow, creating a skill, or coordinating lifecycle commands.
version: 1.0.0
tags: [workflow, meta, agent-coordination]
dependencies: []
agent_types: [planner, worker, reviewer, scout]
tools: [TaskCreate, TaskUpdate, Agent, memory]
---

# Using Pi Skills

## Overview

Skills are Pi's reusable engineering workflows. A skill is not a reference article; it is a procedure with triggers, steps, red flags, and evidence requirements.

Core principle: choose the smallest skill bundle that forces the right behavior and proves completion.

## When to Use

- Starting a non-trivial coding or research session.
- Mapping user intent to Define / Plan / Build / Verify / Review / Ship.
- Creating or revising a skill.
- A task crosses agents, tools, or verification gates.
- Agent output quality is drifting or skipping process.

## When NOT to Use

- One-line answers or trivial file reads.
- When a more specific skill already applies and has been loaded.
- As a substitute for reading the current code.

## Lifecycle Bundles

| User Intent | Phase | Skills |
| --- | --- | --- |
| Clarify idea | Define | `spec-driven-development` |
| Plan work | Plan | `planning-and-task-breakdown` |
| Implement feature | Build | `incremental-implementation` + `test-driven-development` |
| Fix bug | Verify | `debugging-and-error-recovery` + `test-driven-development` |
| Research docs/source | Define/Build | `source-driven-development` |
| Design API/tool contract | Build | `api-and-interface-design` + `documentation-and-adrs` |
| Review change | Review | `code-review-and-quality` + `verification-before-completion` |
| Ship/finish | Ship | `shipping-and-launch` + `verification-before-completion` |
| Context drift | Any | `context-engineering` |

## Workflow

1. Identify user intent and phase.
2. Select one primary skill and at most two supporting skills.
3. State briefly which skill is being used and why when the choice affects workflow.
4. Load only relevant references; do not flood context.
5. Execute the skill's workflow.
6. Complete the skill result contract with evidence.
7. If another phase is needed, hand off explicitly instead of blending phases silently.

## Command Semantics

Pi may expose lifecycle commands as aliases. Their intended bundles are:

- `/spec`: `spec-driven-development`
- `/plan`: `planning-and-task-breakdown`
- `/build`: `incremental-implementation`, `test-driven-development`, fallback `debugging-and-error-recovery`
- `/test`: `test-driven-development`, `debugging-and-error-recovery`, `verification-before-completion`
- `/review`: `code-review-and-quality`, `verification-before-completion`
- `/ship`: `shipping-and-launch`, `documentation-and-adrs`, `verification-before-completion`

## Common Rationalizations

| Rationalization | Rebuttal |
| --- | --- |
| "I'll just use all skills" | Too much context degrades attention. Pick the smallest bundle. |
| "The rules file already says this" | Skills localize the procedure and evidence for this task. |
| "A skill is just advice" | In Pi, skills produce contracts: artifacts, evidence, risks. |
| "I can skip the result contract" | Without evidence, the next agent cannot trust the handoff. |

## Red Flags

- More than three skills loaded for a normal task.
- A skill is cited but no workflow step changes.
- Completion is claimed without the skill result contract.
- A subagent result is trusted without independent verification.
- A lifecycle phase is skipped because the task feels urgent.

## Verification

- The selected skill matches the user's actual intent.
- Supporting skills are minimal and relevant.
- Required evidence is collected before success claims.
- Handoffs include artifacts, verification, and residual risks.

## Skill Result Contract

```xml
<skill_result>
  <skill>using-pi-skills</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Selected skills, lifecycle phase, and completion evidence</evidence>
  <artifacts>Skill files, plans, tasks, or outputs created</artifacts>
  <risks>Overloaded context, missing verification, or none</risks>
</skill_result>
```


## Superseded Legacy Skill

`using-skills` is archived as redundant. `using-pi-skills` is the canonical Pi-native invocation and completion contract.
