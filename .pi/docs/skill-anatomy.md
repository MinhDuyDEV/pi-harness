# Pi Skill Anatomy

Pi skills are executable workflow instructions for agents. They should change behavior, not merely describe best practices.

## File Layout

```text
skills/<skill-name>/
  SKILL.md                 # required entrypoint
  references/<topic>.md    # optional, loaded only when needed
```

## Required Frontmatter

```yaml
---
name: lowercase-hyphen-name
description: Guides agents through the workflow. Use when specific trigger conditions are present.
version: 1.0.0
tags: [workflow]
dependencies: []
agent_types: [planner, worker, reviewer]
tools: []
---
```

Rules:

- `name` must match the directory name.
- `description` must include what the skill does and when to use it.
- `dependencies` names other skills that should be loaded with this one.
- `agent_types` declares which Pi agents commonly apply the skill.
- `tools` lists important tool families but does not replace agent judgment.

## Required Sections

Every skill should include:

1. `Overview` - what behavior this skill enforces and why it matters.
2. `When to Use` - concrete triggers.
3. `When NOT to Use` - exclusions to avoid over-application.
4. `Workflow` - ordered, actionable steps.
5. `Common Rationalizations` - excuses agents use and rebuttals.
6. `Red Flags` - observable signs the workflow is being violated.
7. `Verification` - evidence required before claiming success.
8. `Skill Result Contract` - structured completion block.

## Writing Principles

- Process over prose: write steps the agent can follow.
- Evidence over confidence: every completion claim needs proof.
- Progressive disclosure: keep `SKILL.md` focused; move long checklists to references.
- Anti-rationalization: name the shortcuts agents take under pressure.
- Pi-native enforcement: connect skills to subagents, tasks, memory, and verification gates.

## Skill Result Contract

Skills should end with a block like:

```xml
<skill_result>
  <skill>skill-name</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Commands run, outputs checked, files inspected</evidence>
  <artifacts>path/to/file; path/to/other</artifacts>
  <risks>Known residual risks or none</risks>
</skill_result>
```

If evidence is missing, status cannot be `success`.
