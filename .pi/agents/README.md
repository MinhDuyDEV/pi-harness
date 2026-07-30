# Agent roster

Specialist profiles for the `task` tool. Terminal children load Pi's normal project context; the SDK fallback uses Pi's resource loader but disables extensions. The task brief must still carry outcome-specific constraints instead of assuming ambient policy is sufficient.

The **session agent** is always the parent. Task agents match **OpenCode-style** builtins where applicable: `explore`, `scout`, `general`, `reviewer`, plus `proof-auditor`.

Routing lives in the active project `.pi/APPEND_SYSTEM.md`; project rules live in the root or nearest supported `AGENTS.md` discovered by Pi.

Canonical agents intentionally carry a reproducible `model:` seat so delegation behavior is stable across consumer repositories. Consumers may change a seat explicitly; lock-aware upgrades preserve that change. `thinking:` is tuned per agent as well.

### Model-seat preflight and remapping
- Run `npm run model:preflight` after initialization to list every canonical seat.
- For a host-specific availability check, set `PI_HARNESS_AVAILABLE_MODELS` to a comma-separated list of provider/model IDs and rerun with `--strict`.
- Remap explicitly with `PI_HARNESS_MODEL_MAP='{"provider/model":"provider/available-model"}'`; the preflight never silently substitutes a model. Copy the resulting model fields into consumer agent profiles when the package is not installed.

## Agent file template

```yaml
---
description: >
  When the parent should choose this agent and when NOT to (cheaper tool).
# proactive: true
# hidden: true
# readonly: true
thinking: low
tools:
  write: false
---
```

### What pi-subagents implements

| Field | Enforced? |
| ----- | --------- |
| `description` | Yes — task tool catalog |
| `tools` / `disallowed_tools` | Yes |
| `hidden` / `proactive` / `readonly` | Yes |
| `model` | Yes — passed to the child; canonical seat is pinned and unavailable seats fail clearly |
| `thinking` | Yes — passed to the child |

## Task agents (`task` tool)

| Agent | Use for | Do not use when |
|-------|---------|-----------------|
| `scout` | External research, web/docs, citations | In-repo mapping (`explore`) |
| `explore` | Read-only code exploration, path:line | Single known file (`read`) |
| `general` | Multi-step tasks, implementation, parallel tracks | Trivial 1–2 file parent work |
| `reviewer` | Post-change audit, path:line evidence | Before code exists |
| `proof-auditor` | Verify evidence proves the claim (fake-green/fake-red) | Before code exists, or diff-shape review (`reviewer`) |

## Pick by task

| Task shape | Agent |
|------------|-------|
| How does X work in this repo? | `explore` |
| Best practice / docs for Y? | `scout` |
| Implement or multi-step delegated work | `general` |
| Review diff / changes | `reviewer` |
| Does the evidence actually prove it's done? | `proof-auditor` |
| Product from short prompt | Workflow-style orchestration with `task` |

## Prompt contract (parent → `task`)

Delegate a **governed outcome**, not a recipe:

- **Outcome** — the end state that must be true, stated so a skeptic could check it.
- **Frontier** — the questions the child is empowered to decide on its own.
- **Locked decisions** — each with its rationale and an unlock condition (what evidence would reopen it).
- **Acceptance** — evidence that would convince a skeptic; the child chooses HOW to produce it.
- **Non-goals + write policy** — what must not change.

Do not hand the agent a verification recipe or pre-named acceptance criteria unless genuinely locked.

**Resume:** `task_id` / `conversation_id` from a prior run.

## Answering a challenge

A `blocked` + `<needs_decision>` result is not a failed task — answer the challenge or re-lock with better rationale before re-delegating; never re-issue the same brief unchanged.

## Proactive delegation

**explore, scout, general, reviewer, proof-auditor** use `proactive: true`. Parent rules: `APPEND_SYSTEM.md`.

## Final message XML

Task agents end with `<result>`. Parent must verify artifacts — never ship on a subagent summary alone.

## Standalone profiles (`implementer`, `peer`)

Deliberately orchestrator-free: their prompts never reference who delegated the work, so each file serves both as a `task` agent here and as an independent seat profile (e.g. under Herdr) unchanged. Neither is proactive — the parent grants a write scope (`implementer`) or requests an independent position (`peer`) explicitly.

| Agent | Use for | Do not use when |
|-------|---------|-----------------|
| `implementer` | Sole owner of one write scope; governed outcome, blind pass, own proof, provenance-tagged evidence | Loosely-scoped research+edit errands (`general`); read-only questions |
| `peer` | Read-only independent position on consequential uncertainty; may reframe the question; blind-first on request | Routine diff review (`reviewer`); in-repo mapping (`explore`) |
