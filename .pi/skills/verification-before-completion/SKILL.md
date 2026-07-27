---
name: verification-before-completion
description: Blocks unverified completion claims — every "done" or "passing" must cite a command that ran, exited 0, and had output inspected. Use before claiming complete, before commit/push/PR, or after non-trivial edits.
metadata:
  version: 2.0.0
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

Before any "done", "fixed", "passing", "works", "ready to merge" claim; before commit/push/PR; after non-trivial edits. NOT for pure prose changes or claims backed by a directly observable artifact (cite file + lines).

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

1. **Name the check(s)** *before* editing. Each `incremental-implementation` slice should have one.
2. **Run the check** — paste output (or relevant tail). Truncate, don't paraphrase.
3. **Inspect the exit code** — 0 = green. Non-zero = claim is false, regardless of output.
4. **Inspect the output** — "0 tests run", "all skipped", "compiled with warnings" are not passes.
5. **If a check fails** — work is not done. Enter the verification loop below, or surface the failure.
6. **Cite the artifact** — file path, line range, SHA, or command + output.

For incremental vs full verification scope (changed-files detection, when to run the whole suite), see [references/VERIFICATION_PROTOCOL.md](references/VERIFICATION_PROTOCOL.md).

## The Verification Loop

When a gate fails after implementation, iterate with a cap (an uncapped loop is a sink):

```
for i in 1..N:            # N = 3-5, set before starting
  run the named gate
  if pass: done
  if i == N: escalate with all remaining errors
  apply the smallest fix that resolves the largest gap
```

Iterations count runs of the gate, not tool calls; re-run the same gate every time.

| Continue iterating | Stop and escalate |
|---|---|
| Same kind of failure, fix is clear | Different kind of failure (deeper issue) |
| Errors decreasing | Errors plateauing or increasing |
| Root cause narrowing | New errors introduced each iteration |
| Fix scope understood | Fix scope growing (you're redesigning) |

**At the cap, escalate — don't claim green.** The problem is upstream of the implementation (`debugging-and-error-recovery` or `brainstorming`).

## Common Rationalizations

| Rationalization | Counter |
| --- | --- |
| "One-line change" | They break builds. |
| "Tested in my head" | Mental model ≠ code. |
| "CI will catch it" | That's the failure mode. |
| "The fix should work, move on" | Re-run the gate or you shipped a new issue. |
| "I'm at the cap, it's good enough" | The cap escalates; it doesn't declare done. |

## Red Flags

"It should work" (run it); "I've tested it" (show the run); "tests pass" (paste output); truncating output that hides an error; loop with no cap; gate swapped between iterations; fewer errors claimed without re-running the gate.

## Completion Pattern

```
<skill_result>
  <skill>verification-before-completion</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>
    - <command>: <exit code>, <output tail>
    - <test name>: <runner output>
  </evidence>
  <artifacts>Paths or SHAs touched</artifacts>
  <risks>Untested paths, missing guard, or none</risks>
</skill_result>
```

If `<evidence>` is empty, the claim is unverified. **Do not say "done".** This is the skill's result contract.
