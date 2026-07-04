---
name: debugging-and-error-recovery
description: Use when tests fail, builds break, behavior is unexpected, or multiple fix attempts have not worked.
version: 1.0.0
tags: [debugging, workflow, verification]
dependencies: [test-driven-development, verification-before-completion]
agent_types: [worker, reviewer]
tools: [bash, grep, find, read]
---

# Debugging & Error Recovery

## Overview

Random fixes create new bugs. Debugging must move from symptom to root cause to guarded fix.

Core principle: reproduce, localize, reduce, fix, and guard before claiming resolution.

## When to Use

- Test, lint, typecheck, build, or runtime failure.
- User reports a bug or unexpected behavior.
- A previous fix failed.
- Error crosses multiple layers or components.

## When NOT to Use

- Feature work with no failure signal; use `incremental-implementation`.
- Pure research; use `source-driven-development`.

## Workflow

1. Read the full error and relevant logs.
2. Reproduce the failure or state why it cannot be reproduced.
3. Localize the failing layer: input, boundary, business logic, integration, environment.
4. Reduce to the smallest failing case.
5. Form one hypothesis and test it with one change or one diagnostic.
6. Write a failing regression test when behavior can be tested.
7. Fix the root cause, not only the symptom.
8. Run the original reproduction and relevant regression checks.
9. If three fix attempts fail, stop and escalate architecture/assumption risk. Retry policy: try once with the same tool, then a fallback approach. After 2 consecutive failures, escalate.

## Evidence Log

For complex bugs, maintain a short log in the response or a debug artifact:

```markdown
## Symptoms
- ...
## Reproduction
- ...
## Hypotheses Eliminated
- ...
## Root Cause
- ...
## Fix and Guard
- ...
```

## Common Rationalizations

| Rationalization | Rebuttal |
| --- | --- |
| "This is probably the issue" | Probably is a hypothesis, not evidence. Test it minimally. |
| "I'll patch the symptom now" | Symptom patches hide root causes and regress later. |
| "Multiple fixes will save time" | You will not know which change mattered. |
| "The test failure is unrelated" | Prove it with isolation before ignoring it. |
| "One more attempt" | After three failed fixes, the model is wrong. Stop and rethink. |

## Red Flags

- Code changes before reproduction.
- Fix proposed before reading the full error.
- Same failure persists after two attempts.
- New failures appear in different layers.
- Regression test is skipped for a reproducible bug.
- Success claimed without re-running the original failing scenario.

## Verification

- Original failure is reproduced or documented as non-reproducible.
- Root cause is stated with evidence.
- Regression test or guard exists when feasible.
- Original scenario now passes.
- Related tests/checks pass.

## Skill Result Contract

```xml
<skill_result>
  <skill>debugging-and-error-recovery</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Reproduction, root cause, fix, and verification commands</evidence>
  <artifacts>Changed files, tests, debug notes</artifacts>
  <risks>Non-reproducible behavior, missing regression test, or none</risks>
</skill_result>
```


## Map vs Territory

Before any new fix attempt, run a map-vs-territory check: re-read the request and any notes file. If the plan was wrong, surface it before retrying the same path. Most repeated failures are a mapping problem, not an execution problem.
