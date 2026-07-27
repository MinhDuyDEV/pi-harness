---
name: code-review-and-quality
description: Operational code review — a five-check quality gate, severity-tagged findings, and a Bloat Review mode hunting over-engineering. Use before merge, before claiming work done, or when asked for review.
metadata:
  version: 2.0.0
  tags:
  - review
  - code-quality
  - verification
  dependencies:
  - verification-before-completion
---

# Code Review & Quality

## Core Principle

**Bloat is the default failure mode.** Code grows; review subtracts. The goal is a tight, minimal change that solves the stated problem. A review that lists nits without identifying deletion candidates has missed the point.

## Two-Stage Review

1. **Spec compliance** — does the diff do what was asked, and only that? Missing requirements and out-of-scope changes are found here first.
2. **Quality** — is the change well-built? Duplication, dead code, shallow abstractions, missing tests.

A beautiful diff that solves the wrong problem fails stage 1; don't polish it.

## The Gate (5 Checks)

Code changed this session → the gate runs. Not optional.

1. **Scope** — every line traceable to the stated problem? Anything outside → split or revert. Unrelated cleanup in the diff = wrong diff.
2. **Duplication** — copy-paste instead of reuse? New file with high overlap? Agents duplicate by reflex.
3. **Behavior tests** — new behavior: a test. Bug fix: a regression test. Refactor: existing tests still green.
4. **Verification evidence** — named check ran, exit 0, output captured. Not "should work".
5. **Regressions** — no new failures, no removed tests, no `.skip` on new tests.

Any check fails → work is not done. Overrides (approved scope creep, quarantined flaky test, test replaced by a better one) are legitimate but must be documented, not hidden.

## Severity Tags

`[blocker]` name the violated invariant and smallest fix · `[should-fix]` name the cost of leaving it · `[nit]` note, don't block · `[question]` need clarification. Unrelated issues: `[NOTICED BUT NOT TOUCHING]` — never silently fix.

## Bloat Review Mode

For AI-generated code, post-refactor, or suspected scope creep. Output a **delete-list**: `[delete]` unused/dead/speculative · `[simplify]` works but over-engineered · `[keep-with-reason]` looks bloat, is load-bearing (justify or demote to `[delete]`). Default for any line that does not serve the stated problem is `[delete]`. Ask: "If I delete this, what breaks?" If nothing — bloat.

## Iron Laws by Domain

| Domain | Iron law |
| --- | --- |
| Any feature / bugfix | Failing test first (`test-driven-development`) |
| TS / JS with Effect | Typed errors, no `any` (`typescript-coding-standards`) |
| React / Next.js | Server components, bundle discipline (`react-best-practices`) |
| UI | Base aesthetic rules (`design-taste-frontend`) |
| Performance | Measure before optimizing (`performance-optimization`) |
| Security | Validate at every layer (`defense-in-depth`) |

## Requesting and Receiving Review

- **Requesting:** state the problem, the approach, and the verification command with its output.
- **Receiving:** treat `[blocker]`s as claims to verify, not orders — push back with evidence if the reviewer is wrong, fix if right. Never resubmit without re-running the gate.
- **Reviewing others/subagents:** read the diff, not the self-report. Self-reported success is the failure mode review exists to catch.

## Anti-rationalization

| Shortcut the model reaches for | Why it fails here |
|---|---|
| "The tests pass, so it's done" | Green proves nothing about scope, duplication, or evidence. |
| "It's a small change, skip the gate" | Small changes skip regression checks — exactly how regressions ship. |
| "The author says it works" | Read the diff, not the claim. |
| "Bloat review = delete aggressively" | Bloat mode targets over-engineering; tag load-bearing complexity, don't delete blindly. |

## Red Flags

"Should work" / "I tested it" without output; truncated output hiding errors; `.skip` on new tests; removed tests unmarked; "while I'm here" changes unmarked; LGTM-by-default; style nits as the whole review (run the linter); review with zero `[delete]`/`[simplify]` findings (shallow); blockers downgraded to nits to avoid friction.
