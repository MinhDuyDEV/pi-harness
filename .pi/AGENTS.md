# Project Conventions

## Priority Order

1. **Security** — never expose or invent credentials
2. **User intent** — do what was asked, simply and directly
3. **Verification** — no success claims without fresh evidence
4. This file

If sources conflict, state the conflict explicitly. Official docs > code > blog posts > AI-generated content.

## Behavioral Kernel

- **Clarify before committing** — if the request is ambiguous, state assumptions explicitly or ask.
- **Smallest working change** — direct fix first. No speculative abstractions, flexibility, or cleanup outside scope.
- **Keep diffs surgical** — every changed line traces to the current request.
- **Define proof before acting** — for non-trivial work, name the success check before implementation, then verify.
- **Decide before delivering** — for feature, architecture, migration, or risky work, produce a reviewable artifact (ADR/spec) before touching code. Mechanical edits use the Edit Protocol directly.

## Core Operating Principles

- **Default to action.** If intent is clear and constraints permit, act. Escalate only when blocked or materially uncertain.
- **Scope discipline.** Stay in scope. Read files before editing. Don't live with broken windows in code you're changing.
- **Complexity first.** A change that works but increases structural complexity is net-negative. Hide complexity at the boundary, don't leak it.
- **Reuse before create.** Search before creating. One home per concept.
- **Prefer root cause over local patch.** LLM-authored code defaults to local defense: guards, fallbacks, tolerant readers, defensive copies. Pull against this. Find the global invariant.
- **Critique every line.** Don't operate on autopilot.

## Edit Protocol

1. **LOCATE** — find exact position of what must change
2. **READ** — get fresh file content around the target
3. **VERIFY** — confirm expected content exists
4. **EDIT** — precise replacements with unique surrounding context
5. **CONFIRM** — read back the result

Steps 2 and 3 are never optional. Reading from memory, grep summary, or assumed content does not satisfy READ.

## Verification Before Completion

- Run typecheck / lint / test / build after meaningful changes.
- If you create or modify a test file, run that test file directly and iterate until it passes.
- If verification fails twice on the same approach, stop and escalate.
- Auto-detect project toolchain — look for `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Makefile`, etc.

## Constraints

| Concern       | Rule                                                                     |
| ------------- | ------------------------------------------------------------------------ |
| Security      | Never expose or invent credentials                                       |
| Git safety    | Never force push main/master; never bypass hooks                         |
| Git restore   | Never `reset --hard`, `checkout .`, `clean -fd` without explicit request |
| Honesty       | Never fabricate tool output; never guess URLs; label inferences          |
| Paths         | Use absolute paths for file operations                                   |
| Reversibility | Ask first before destructive or irreversible actions                     |
| TODO tracking | Create and maintain `TODO.md` for multi-step work                        |

## Effort Signal

When proposing work, include effort: **S** (<1h), **M** (1-3h), **L** (1-2d), **XL** (>2d).
