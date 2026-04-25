---
name: behavioral-kernel
description: Use when work starts drifting into silent assumptions, overengineering, drive-by refactors, or vague completion claims. Re-centers the agent on a compact Pi-native execution kernel with concrete anti-pattern examples.
version: 1.0.0
tags: [workflow, behavior, anti-slop]
dependencies: []
agent_types: [planner, worker, reviewer]
tools: []
---

# Behavioral Kernel

A short reset skill for non-trivial work when the larger prompt is getting noisy.

## Kernel

1. **Clarify before committing** — surface assumptions or ask instead of silently choosing.
2. **Choose the smallest working change** — solve today's problem directly before inventing flexibility.
3. **Keep diffs surgical** — change only what the request requires; log unrelated issues and keep moving.
4. **Define proof before acting** — say how success will be verified before implementation, then run that proof after.

## Apply the Kernel

Before coding, write down:

- the ambiguity or assumptions in 1-3 bullets
- the smallest acceptable diff
- what you are explicitly not touching
- the verification command, test path, or evidence you will use

## Drift Signals

Stop and reload this kernel if you catch yourself:

- adding abstraction for a single use case
- changing adjacent code "while you're here"
- postponing verification until the end
- claiming completion without a named proof path
- silently picking one interpretation from multiple valid readings

## Recovery Move

When drift is detected:

1. Re-state the request in one sentence.
2. Re-state the smallest working change.
3. Re-state the proof path.
4. Delete or avoid anything outside that boundary.

## References

- See [references/examples.md](references/examples.md) for Pi-native bad-vs-good examples.
