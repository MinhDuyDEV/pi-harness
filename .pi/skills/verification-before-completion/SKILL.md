---
name: verification-before-completion
description: Blocks unverified completion claims — every "done" or "passing" must cite a command that ran, exited 0, and had output inspected. Use before claiming complete, before commit/push/PR, or after non-trivial edits.
metadata:
  version: 2.1.0
  tags:
  - workflow
  - code-quality
  dependencies: []
---

# Verification Before Completion

## The Iron Law

<EXTREMELY-IMPORTANT>
**No completion claim without evidence.** "Done" = the named verification command ran, exited 0, output inspected. Not "should work", "looks right", "tested locally". **Evidence before assertion, always.**
</EXTREMELY-IMPORTANT>

## When to Use

Before any "done", "fixed", "passing", "works", or "ready" claim; before commit/push/PR; after non-trivial edits. For prose or directly observable artifacts, cite the file and lines.

## Verification Hierarchy

| Claim | Required evidence |
| --- | --- |
| "Test passes" | Test runner output, exit 0 |
| "Typecheck clean" | `tsc --noEmit`, exit 0 |
| "Lint clean" | Linter output, exit 0 |
| "Build succeeds" | Build output, exit 0 |
| "Behavior is X" | Repro + observed output |
| "Code matches spec" | Diff or path + line range |
| "Bug is fixed" | Regression test fails without, passes with |
| "Shipped" | All + commit / PR link |

Prose and code review are inspection, not verification.

## Workflow

1. **Name checks before editing.** Give each implementation slice one.
2. **Run them.** Show output or its relevant tail; do not paraphrase away failures.
3. **Inspect exit and output.** Non-zero is failure; zero tests, all skipped, or hidden warnings are not proof.
4. **On failure**, enter the loop below or report it. Never claim done.
5. **Cite evidence:** path/lines, SHA, or command and output.

For incremental vs full verification scope (changed-files detection, when to run the whole suite), see [references/VERIFICATION_PROTOCOL.md](references/VERIFICATION_PROTOCOL.md).

## The Verification Loop

When a gate fails, iterate with a preset cap:

```
for i in 1..N:            # N = 3-5, set before starting
  run the named gate
  if pass: done
  if i == N: escalate with all remaining errors
  apply the smallest fix that resolves the largest gap
```

Count gate runs, not tool calls; re-run the same gate.

| Continue iterating | Stop and escalate |
|---|---|
| Same kind of failure, fix is clear | Different kind of failure (deeper issue) |
| Errors decreasing | Errors plateauing or increasing |
| Root cause narrowing | New errors introduced each iteration |
| Fix scope understood | Fix scope growing (you're redesigning) |

**At the cap, escalate; do not claim green.** Switch to debugging or reconsider the design.

## Red Flags

"It should work"; "tested in my head"; "CI will catch it"; output truncated over an error; uncapped loops; swapped gates; claiming fewer errors without re-running.

## Report

Report verification in normal, concise prose; do not emit a mandatory XML or JSON wrapper. Match detail to the claim:

- **Result:** state whether the requested outcome is verified, partial, blocked, or unverified.
- **Evidence:** name the exact command or probe, exit status, relevant output, and path or SHA when applicable.
- **Limits:** state skipped checks, remaining risks, or unavailable independent review; never imply stronger proof than the evidence supports.

Small changes may need only diff review and a focused command. Behavior changes need relevant tests and typecheck. Research separates sourced fact, inference, and uncertainty. If no check ran, name it and explain why; urgency does not waive evidence.
