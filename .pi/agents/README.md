# Agent roster

Specialist agents for the `task` tool. Each file is a **standalone system prompt** — no `AGENTS.md` / `APPEND_SYSTEM.md` inheritance unless the parent passes rules in the task `prompt`.

The **session agent** is always the parent. Task agents match **OpenCode-style** builtins where applicable: `explore`, `scout`, `general`, plus `reviewer`.

Routing: `~/.pi/agent/APPEND_SYSTEM.md` (Delegation). Rules: `AGENTS.md` / project `.pi/AGENTS.md`.

## Agent file template

```yaml
---
description: >
  When the parent should choose this agent and when NOT to (cheaper tool).
# proactive: true
# hidden: true
# readonly: true
tools:
  write: false
---
```

### What pi-task implements

| Field | Enforced? |
| ----- | --------- |
| `description` | Yes — task tool catalog |
| `tools` / `disallowed_tools` | Yes |
| `hidden` / `proactive` / `readonly` | Yes |
| `model`, `thinking` | Yes — passed to child `pi` |

## Task agents (`task` tool)

| Agent | Use for | Do not use when |
|-------|---------|-----------------|
| `scout` | External research, web/docs, citations | In-repo mapping (`explore`) |
| `explore` | Read-only code exploration, path:line | Single known file (`read`) |
| `general` | Multi-step tasks, implementation, parallel tracks | Trivial 1–2 file parent work |
| `reviewer` | Post-change audit, path:line evidence | Before code exists |

## Pick by task

| Task shape | Agent |
|------------|-------|
| How does X work in this repo? | `explore` |
| Best practice / docs for Y? | `scout` |
| Implement or multi-step delegated work | `general` |
| Review diff / changes | `reviewer` |
| Product from short prompt | Workflow-style orchestration with `task` |

## Prompt template (parent → `task`)

Include: goal, non-goals, write/read policy, expected output, stop condition, verification recipe.

**Resume:** `task_id` / `conversation_id` from a prior run.

## Proactive delegation

**explore, scout, general, reviewer** use `proactive: true`. Parent rules: `APPEND_SYSTEM.md`.

## Final message XML

Task agents end with `<result>`. Parent must verify artifacts — never ship on subagent summary alone.