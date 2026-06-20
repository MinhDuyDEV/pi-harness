---
name: incremental-implementation
description: Delivers changes in thin verified slices. Use when implementing any feature, refactor, or change touching more than one file, or when tempted to write a large patch before testing.
version: 1.0.0
tags: [workflow, implementation, safety]
dependencies: [verification-before-completion]
agent_types: [worker]
tools: [grep, find, read, bash, edit, write]
---

# Incremental Implementation

## Overview

Build one **vertical slice** — a thin, end-to-end, independently verifiable piece of behavior — verify it, then continue. Large unverified patches compound mistakes and make rollback painful.

**Why vertical, not horizontal**: Horizontal slicing (do all of layer X first, then all of layer Y) leaves every layer half-wired and unverifiable until the last piece lands. Vertical slicing (one complete path through all layers) makes each increment independently testable. For AI agents, vertical slices are critical: a shallow horizontal slice gives the AI no feedback signal until the entire layer is done, by which point errors have compounded. A thin vertical slice gives immediate feedback — type errors, test failures, wiring gaps — within minutes.

**Tracer bullet approach**: Start with the thinnest possible end-to-end slice that proves the path works. It can be hardcoded, minimal, or use stub data — as long as it touches every layer and can be verified. Once the tracer bullet flies, expand it in safe increments rather than building from scratch.

Core principle: each increment leaves the repo in a working, testable state.

## When to Use

- Multi-file implementation.
- Refactor with behavioral risk.
- Plan execution with multiple tasks.
- Any time more than about 100 lines may be written before testing.

## When NOT to Use

- Single-function edits with obvious verification.
- Pure documentation edits; still verify links/format if relevant.

## Workflow

For each slice:

1. Read the task packet and relevant files.
2. Define the smallest complete slice.
3. State scope and non-goals for the slice.
4. If behavior changes, use `test-driven-development`.
5. Implement only that slice.
6. Run targeted verification.
7. Inspect the diff for scope creep and stubs.
8. Create a checkpoint when the user/repo workflow allows commits; otherwise record the verified state.
9. Move to the next slice only when green.

If verification fails, fix within the current slice before continuing. Do not stack new slices on broken code.

## Slicing Strategies

| Strategy | Use When | Example |
| --- | --- | --- |
| Vertical (tracer bullet) | Default — normal features | One API path + DB query + minimal UI — the thinnest complete path |
| Contract-first | Frontend/backend can split | Types/schema first, then implementations |
| Risk-first | Unknown integration | Prove external API or migration path first |
| Additive | Risky refactors | Add new path, wire, then remove old path later |

## Slice Size Guide

| Size | Meaning |
| --- | --- |
| 1-30 lines | Ideal; easy to review and verify. |
| 30-100 lines | Acceptable if one logical change. |
| 100-200 lines | Usually too large; find a split point. |
| 200+ lines | Stop. This is big-bang implementation. |

## Checkpoint Policy

- Prefer atomic commits as rollback points only when the user/repo workflow allows committing.
- Never auto-commit in a dirty user worktree unless explicitly instructed.
- If not committing, report a clear checkpoint: files changed, checks passed, next slice.
- Each checkpoint should be independently revertable or easy to isolate.

## Scope Discipline

Do not:

- Clean unrelated code.
- Modernize syntax outside touched scope.
- Add convenience features not in acceptance criteria.
- Refactor while implementing unless the task requires it.
- Leave incomplete feature visible without a guard/flag.

If you notice adjacent issues, report them as follow-ups.

## Common Rationalizations

| Rationalization | Rebuttal |
| --- | --- |
| "It's faster to do it all at once" | It feels faster until debugging a 500-line diff. Complexity compounds from unverified code. |
| "I'll test at the end" | Bugs in early slices poison later work. AI agents amplify this: a wrong assumption in slice 1 gets reinforced in slices 2-5 before anyone notices. |
| "Horizontal layering is more efficient" | Horizontal leaves every layer half-wired. You can't verify anything until every layer is done — that's a batch, not an increment. |
| "This refactor is small enough to include" | Mixed concerns make review and rollback harder. |
| "The feature is incomplete, but hidden enough" | Incomplete user-visible behavior needs a flag or must not merge. |

## Red Flags

- More than 100 lines changed without verification.
- Diff contains unrelated cleanup.
- Multiple task goals in one patch.
- Tests/build broken between increments.
- TODO/stub/placeholder added without explicit acceptance.
- Worker expands beyond 3 files without reporting scope growth.

## Verification

- Targeted tests or checks run for each slice.
- Typecheck/build/lint run when affected by the slice.
- Diff reviewed for scope creep and stubs.
- Acceptance criteria for the slice are satisfied.
- Remaining slices are explicitly listed if work is partial.

## Skill Result Contract

```xml
<skill_result>
  <skill>incremental-implementation</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Commands run, diff inspected, slice acceptance checks passed</evidence>
  <artifacts>Changed files</artifacts>
  <risks>Unverified checks, partial slices, or none</risks>
</skill_result>
```
