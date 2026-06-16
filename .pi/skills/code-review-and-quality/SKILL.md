---
name: code-review-and-quality
description: Reviews code for correctness, regressions, security, maintainability, and goal completion. Use before merge, after subagent work, or when asked for a review. Bloat Review mode hunts over-engineering only (delete-list with tagged findings).
version: 1.0.0
tags: [review, code-quality, verification]
dependencies: [verification-before-completion]
agent_types: [reviewer]
tools: [srcwalk_search, srcwalk_deps, bash]
---

# Code Review & Quality

## Overview

Review is a bug-finding activity, not a compliment sandwich. The reviewer verifies that the goal is actually achieved and that the change does not introduce unacceptable risk.

Core principle: findings first, with file:line evidence and impact.

**Complexity is a correctness issue.** A change that works but adds structural complexity introduces risk: it makes future changes harder, slower, and more error-prone. The reviewer must assess structural quality alongside behavioral correctness.

Use the **three complexity symptoms** as review lenses:
- **Change amplification**: does a small future change require touching many places?
- **Cognitive load**: does the reviewer (or AI agent) need to understand too much of the system to assess one change?
- **Unknown unknowns**: is it obvious what needs to change for a new requirement, or are there hidden dependencies?

## When to Use

- User asks for review.
- User asks to review for bloat, over-engineering, or "what can we delete" — use **Bloat Review mode** (below).
- Before merge/ship.
- After a worker or subagent reports completion.
- Refactors, security-sensitive changes, API changes, migrations, concurrency, or auth.
- Any change where complexity may have been introduced (always suspect).

## When NOT to Use

- Planning decisions before code exists; use `planning-and-task-breakdown`.
- Implementation; reviewer must stay read-only.
- Style-only commentary unless it hides a real bug.

## Workflow

1. Identify base and changed files.
2. Read the diff and nearby context.
3. Review along two axes when a spec/issue/PRD exists:
   - **Standards** — does the change follow documented repo standards, ADRs, and conventions?
   - **Spec** — does the change faithfully implement what was requested, without missing requirements or scope creep?
4. Verify goal completion: exists, substantive, wired.
5. Check key links: UI -> API, API -> database, form -> handler, state -> render, command -> effect.
6. **Assess for complexity symptoms**:
   - Is the interface of each new module as complex as its implementation? (shallow module — Ousterhout)
   - Does a change leak information between unrelated modules?
   - Would a future developer (or AI agent) know where to make the next change?
7. Look for correctness, security, performance, compatibility, and maintainability issues.
8. Run or inspect relevant verification when allowed.
9. **Scan for broken windows** — does the change introduce or fix code that normalizes decay? Messy imports, inconsistent patterns, TODO rot, dead code?
10. Report only actionable findings that the author should fix.
11. If no findings, say so and list residual testing gaps.

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

## Bloat Review Mode

Use when the user asks to review for over-engineering, bloat, unnecessary abstractions, or "what can we delete" — including via `/verify --review --bloat`.

**Scope:** complexity and unnecessary code only. The diff's best outcome is getting shorter.

**Do not use for:** correctness bugs, security holes, performance regressions, or missing tests. Route those to the standard review workflow above.

### Output format

One line per finding:

```text
L<line>: <tag> <what>. <replacement>.
```

For multi-file diffs:

```text
<path>:L<line>: <tag> <what>. <replacement>.
```

### Tags

| Tag | Meaning | Replacement |
| --- | --- | --- |
| `delete:` | Dead code, unused flexibility, speculative feature | Nothing |
| `stdlib:` | Hand-rolled thing the standard library ships | Name the function |
| `native:` | Dependency or code doing what the platform already does | Name the feature |
| `yagni:` | Abstraction with one implementation, config nobody sets, layer with one caller | Inline or defer |
| `shrink:` | Same logic, fewer lines | Show the shorter form |

### Examples

Bad: `This EmailValidator class might be more complex than necessary at this stage.`

Good: `L12-38: stdlib: 27-line validator class. "@" in email, 1 line; real validation is the confirmation mail.`

### Scoring

End with the only metric that matters:

```text
net: -<N> lines possible.
```

If there is nothing to cut:

```text
Lean already. Ship.
```

### Boundaries

- Does not apply fixes — lists them only.
- A single smoke test or assert-based self-check is the minimum proof, not bloat — never flag it for deletion.
- Pair with `fallow health` / `aislop scan` for repo-wide audits; Bloat Review mode is diff-focused unless explicitly asked for full-tree scan.

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

## Complexity Red Flags

- **New module with shallow interface**: lots of public methods/props for small implementation — it's not hiding complexity, it's exposing it.
- **Information leakage**: one module exposes internal implementation details another module depends on.
- **Change amplification signal**: a simple conceptual change would touch many files — the structure is fighting the domain.
- **Cognitive load spike**: the diff requires understanding 5+ unrelated files to verify one change.
- **Pass-through methods**: methods that do nothing but delegate with the same signature — a sign the abstraction boundary is wrong.
- **Broken windows introduced**: messy formatting, dead imports, TODOs without tickets, inconsistent conventions within the same file.

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
