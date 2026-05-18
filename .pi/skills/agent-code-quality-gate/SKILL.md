---
name: agent-code-quality-gate
description: Use before a coding agent claims implementation work is complete, especially after bugfixes, feature edits, refactors, or subagent changes - converts code quality into an operational gate for scope, duplication, behavior tests, verification evidence, and regressions.
version: 1.0.0
---

# Agent Code Quality Gate

## Overview

Code quality for an agent is not "clean-looking code." It is a small, reviewable, verified change that improves or preserves system health while solving the requested problem.

Core rule: **do not claim completion until the diff is scoped, integrated, tested for behavior, and freshly verified.**

## When to Use

Use before saying work is complete, fixed, passing, ready, or high quality after:

- implementing a feature or bugfix;
- editing production code or tests;
- receiving subagent/worker changes;
- refactoring, optimizing, or migrating code;
- touching security, auth, data, concurrency, payments, accessibility, performance, or public APIs.

Do not use as a substitute for specialist review. For final merge/security/API review, also load the relevant review/security/API skill.

## Quality Gate

Answer every item. If any answer is "no" or "unknown," either fix it, verify it, or report the remaining risk explicitly.

| Gate | Pass condition | Reject if |
| --- | --- | --- |
| Goal | The change satisfies the user's actual request and acceptance criteria. | It solves a nearby or imagined problem. |
| Scope | Every changed line traces to the current request. | Drive-by cleanup, broad formatting, or speculative refactor is mixed in. |
| Design fit | The change belongs in the touched layer and follows existing architecture. | It adds a parallel pattern, hidden business logic, or misplaced abstraction. |
| Simplicity | The solution is the smallest clear working change. | It adds flexibility for hypothetical future needs. |
| Duplication | Existing helpers/components/patterns were searched and reused. | A second home for the same concept was created. |
| Behavior | Relevant happy path, edge cases, and failure path were considered. | Only the obvious path works. |
| Tests | Tests are meaningful for behavior and would fail if the behavior broke. | Tests only assert mocks, snapshots, implementation details, or coverage numbers. |
| Verification | Fresh relevant lint/typecheck/test/build/manual check evidence exists. | Success is inferred from code appearance or a subagent report. |
| Regressions | Security, reliability, performance, accessibility, compatibility, and developer workflow are not worsened. | Any regression is unexamined or hand-waved. |
| Reviewability | Diff is coherent and easy to review. | Reviewer must reverse-engineer why unrelated changes exist. |

## Agent-Specific Failure Modes

Brutally check for these before completion:

- **Hallucinated API:** Did you verify signatures/options against local types, source, or official docs?
- **Fake confidence:** Are you saying "should work" instead of citing command output or runtime evidence?
- **Subagent trust:** Did you read changed files and verify independently instead of trusting a summary?
- **Mock theater:** Do tests prove production behavior, or just that mocks were called?
- **Coverage worship:** Coverage can reveal untested code; it does not prove test quality.
- **Speculative abstraction:** Did you add generic hooks/options/classes before the actual need exists?
- **Duplicate utility:** Did you search before creating a helper/component/schema wrapper?
- **Generated-file edit:** Did you modify generated output instead of the canonical schema/generator/input?
- **Silent behavior change:** Did any external behavior, API shape, data format, or command contract change without explicit approval?
- **Unreviewable diff:** Did formatting churn or cleanup obscure the real behavior change?

## Minimal Completion Procedure

1. Re-read the user request and acceptance criteria.
2. Inspect the diff, not just the files.
3. Remove unrelated or speculative changes.
4. Search for existing concepts before keeping new helpers/components.
5. Check behavioral edges: invalid input, empty state, permission failure, error path, concurrency/race risk where relevant.
6. Run the smallest relevant verification first; expand only if risk requires it.
7. If tests were added or changed, run those tests directly and confirm they fail for the right reason when practical.
8. Record exact evidence in the final response: command/check + result + remaining risk.

## Source-Backed Principles

- Google Engineering Practices: approve changes that improve overall code health; reject changes that worsen it even if they appear functional. Review design, functionality, complexity, tests, names, comments, style, consistency, docs, and every relevant line.
- Martin Fowler on test coverage: coverage is useful for finding untested code, but high coverage is not proof of good tests.
- OWASP Secure Coding Practices: quality includes input validation, output encoding, auth/session/access control, cryptography, error handling/logging, data protection, database/file/memory safety, and general secure coding.

## Final Response Evidence Pattern

Use this shape when reporting completion:

```text
Changed <what> in <file:line> to satisfy <requirement>.
Verification: <command/check> passed/failed with <specific result>.
Risk: <none known | untested area and why>.
```

Never say "done," "fixed," "passes," or "high quality" without fresh evidence.

## Skill Result Contract

```xml
<skill_result>
  <skill>agent-code-quality-gate</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Diff reviewed, scope checked, tests/verification run, sources checked if APIs used</evidence>
  <artifacts>Files reviewed or commands run</artifacts>
  <risks>Remaining unverified paths or none</risks>
</skill_result>
```
