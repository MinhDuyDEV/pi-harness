---
name: best-of-n
description: Use when one-shot delegation is risky - run N parallel worker attempts in isolated worktrees, compare episode quality, and select the strongest verified result
version: 1.0.0
tags: [agent-coordination, workflow, debugging]
dependencies: []
---

# Best-of-N Delegation

## When to Use

- Complex bug fixes with multiple plausible root causes
- Non-deterministic tasks (race conditions, flaky tests, intermittent failures)
- Critical-path work where a single weak attempt is too risky

## When NOT to Use

- Simple, deterministic tasks with obvious solutions
- Exploratory/read-only work (use research/explore patterns instead)
- Tasks where parallel edits would add overhead without quality gain

## Overview

Best-of-N means running multiple independent implementation attempts in parallel, then selecting the best verified outcome.

**Core principle:** parallel diversity + strict selection beats single-shot guessing.

## The Pattern

1. Define one clear objective and acceptance criteria
2. Spawn **N worker agents** in parallel with `isolation: "worktree"` and `run_in_background: true`
3. Require each worker to return:
   - a concise summary
   - verification evidence (tests/typecheck/lint)
   - confidence score (0.0-1.0)
   - final `<episode>` block
4. Compare all N outcomes
5. Pick the best candidate using deterministic selection rules
6. If no candidate succeeds, merge blockers into one escalation report

## Concrete Agent Tool Example

```typescript
// Same objective, different strategies across workers
const a1 = Agent({
  type: "worker",
  run_in_background: true,
  isolation: "worktree",
  prompt: `Fix flaky test in auth/session.spec.ts.
Strategy: instrument timing and replace sleeps with condition-based waiting.
Return verification output + confidence (0.0-1.0) + <episode>.`,
});

const a2 = Agent({
  type: "worker",
  run_in_background: true,
  isolation: "worktree",
  prompt: `Fix flaky test in auth/session.spec.ts.
Strategy: trace event ordering and patch race in production code if needed.
Return verification output + confidence (0.0-1.0) + <episode>.`,
});

const a3 = Agent({
  type: "worker",
  run_in_background: true,
  isolation: "worktree",
  prompt: `Fix flaky test in auth/session.spec.ts.
Strategy: tighten setup/teardown isolation and remove shared mutable state.
Return verification output + confidence (0.0-1.0) + <episode>.`,
});
```

Then collect each result and evaluate.

## Selection Criteria (in order)

1. `episode.status === "success"` outranks `"partial"`
2. Verification must pass (reject candidates without passing evidence)
3. Among valid candidates, choose highest confidence
4. Tie-breaker: prefer smaller, cleaner diff with clearer root-cause explanation

Pseudo-ranking:

```text
success + verification pass + high confidence
> success + verification pass + lower confidence
> partial + verification pass
> partial/failure without verification
```

## Fallback (No Successes)

If no worker returns `episode.status = success` with passing verification:

1. Do **not** pick a winner
2. Aggregate blockers from all N attempts
3. Report:
   - recurring blockers (shared across attempts)
   - unique blockers per attempt
   - most promising next step (single recommended path)

## Practical Tips

- Usually `N = 2` or `N = 3`; higher N has diminishing returns
- Keep prompts same objective, different strategy
- Require workers to stay in scope (no broad refactors)
- Always gate selection on real verification output, not narrative quality
