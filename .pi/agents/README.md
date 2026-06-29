# Agent Catalog

Built-in agent types for the `task` tool. Project can add custom agents at `.pi/agents/<name>.md`.

## Types

| Agent | Use for | Tool access |
|-------|---------|-------------|
| `scout` | External research, web/docs, cited guidance | Web tools only |
| `explore` | Read-only code exploration, file:line evidence | read, grep, find, ls |
| `planner` | Implementation plan + risk + acceptance, no edits | read, grep, find, ls |
| `reviewer` | Post-change audit (correctness/security/regression), file:line evidence | read, grep, find, ls, diagnostics |
| `vision` | UI/UX visual review from screenshots or code | read, image tools |
| `worker` | Small scoped implementation, runs checks, reports files changed | All except `task` / `harness` |

## Task Tool Schema

```ts
{
  agent_type:       string;   // required, see table above
  description:      string;   // required, 3-5 words, UI label
  prompt:           string;   // required, see Prompt Template
  background?:      boolean;  // default false; true only if you can do other work first
  conversation_id?: string;   // reuse for continuity with prior specialist call
}
```

## Prompt Template (mandatory fields)

- **Goal** — one sentence
- **Non-goals** — what NOT to do
- **Write policy** — edit / no-edit / allowed paths
- **Read policy** — conventions, prior outputs to consume
- **Expected output** — artifact path or report shape
- **Stop condition** — when to stop
- **Failure handling** — return partial / retry / stop
- **Verification** — parent reads the file, never trusts the summary

## Pick by Task Shape

- find / research / cite → `scout`
- map / locate / where is → `explore`
- plan / design / how to implement → `planner`
- review / audit / check this change → `reviewer`
- UI / visual / layout → `vision`
- implement / make this small change → `worker`

**Do yourself** (don't delegate): ≤3 tool calls, 1-2 files, secrets, edits needing current-conversation nuance, anything you'd re-verify yourself.
