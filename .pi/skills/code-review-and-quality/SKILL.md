---
name: code-review-and-quality
description: Reviews code for correctness, regressions, security, maintainability, and goal completion. Use before merge, after subagent work, or when asked for a review.
version: 1.0.0
tags: [review, code-quality, verification]
dependencies: [verification-before-completion]
agent_types: [reviewer]
tools: [tilth_search, tilth_deps, bash]
---

# Code Review & Quality

## Overview

Review is a bug-finding activity, not a compliment sandwich. The reviewer verifies that the goal is actually achieved and that the change does not introduce unacceptable risk.

Core principle: findings first, with file:line evidence and impact.

## When to Use

- User asks for review.
- Before merge/ship.
- After a worker or subagent reports completion.
- Refactors, security-sensitive changes, API changes, migrations, concurrency, or auth.

## When NOT to Use

- Planning decisions before code exists; use `planning-and-task-breakdown`.
- Implementation; reviewer must stay read-only.
- Style-only commentary unless it hides a real bug.

## Workflow

1. Identify base and changed files.
2. Read the diff and nearby context.
3. Verify goal completion: exists, substantive, wired.
4. Check key links: UI -> API, API -> database, form -> handler, state -> render, command -> effect.
5. Look for correctness, security, performance, compatibility, and maintainability issues.
6. Run or inspect relevant verification when allowed.
7. Report only actionable findings that the author should fix.
8. If no findings, say so and list residual testing gaps.

## Severity

| Priority | Meaning |
| --- | --- |
| P0 | Critical: data loss, security break, crash on common path, release blocker. |
| P1 | High: likely user-visible bug or serious regression. |
| P2 | Medium: edge-case bug, maintainability hazard with concrete impact. |
| P3 | Low: minor issue worth fixing but not blocking. |

## Finding Template

```text
[P1] Title — path/to/file.ts:42
Impact: What breaks and when.
Evidence: Concrete code behavior.
Confidence: 0.0-1.0
```

## Common Rationalizations

| Rationalization | Rebuttal |
| --- | --- |
| "The implementation looks reasonable" | Review behavior and wiring, not aesthetics. |
| "The worker said tests pass" | Verify independently or mark as unverified. |
| "This is probably pre-existing" | Only skip if evidence shows it was not introduced or worsened. |
| "I should mention style too" | Style-only noise hides real findings. |

## Red Flags

- No file:line evidence for a finding.
- Findings describe preferences rather than bugs/risks.
- Review ignores acceptance criteria.
- Created files are not imported or invoked anywhere.
- Static placeholder responses or no-op handlers satisfy superficial tests.
- Reviewer modifies files.

## Verification

- Changed artifacts exist.
- Implementations are substantive, not stubs/placeholders.
- Key links are wired and exercised.
- Findings are ordered by severity.
- Verdict is explicit: correct or incorrect.

## Skill Result Contract

```xml
<skill_result>
  <skill>code-review-and-quality</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Files reviewed, commands/checks run, findings with file:line evidence</evidence>
  <artifacts>Reviewed files or diff range</artifacts>
  <risks>Untested areas, unavailable base, or none</risks>
</skill_result>
```


## Consolidated Review Workflow

This is the canonical active review skill. It absorbs requesting-code-review, receiving-code-review, sprint-review, and reconcile responsibilities.

Use it for:
- self-review before claiming completion;
- subagent or peer review routing;
- skeptical treatment of received review comments;
- severity-ranked findings with file/line evidence;
- reconciliation between user intent, implementation, tests, and remaining risk.
