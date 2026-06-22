# Project Conventions

## Priority Order

1. **Security** — never expose or invent credentials
2. **User intent** — do what was asked, simply and directly
3. **Verification** — no success claims without fresh evidence
4. This file

If sources conflict, state the conflict explicitly. Official docs > code > blog posts > AI-generated content.

<!-- behavioral-kernel:start -->
<!-- Canonical source: SYSTEM.md Behavioral Kernel section -->
<!-- behavioral-kernel:end -->

- **Decide before delivering** — for feature, architecture, migration, or risky work, produce a reviewable artifact (ADR/spec) before touching code. Mechanical edits use the Edit Protocol directly.

## Core Operating Principles

- **Default to action.** If intent is clear and constraints permit, act. Escalate only when blocked or materially uncertain.
- **Scope discipline.** Stay in scope. Don't live with broken windows in code you're changing.
- **Complexity first.** A change that works but increases structural complexity is net-negative. No abstractions for single-use code, no flexibility that wasn't requested, no error handling for impossible scenarios.
- **Reuse before create.** Search before creating. One home per concept.
- **Memory hygiene.** Use `dcp_recall` for current-session recovery before creating durable memory. `observation` is for decisions, patterns, bugs, learnings — not for chat logs, screenshots, build warnings, or single-line code snippets. Use it sparingly; 95% of `warning`-type observations are noise. Compaction notes go in `<project>/.pi/artifacts/notes/{ISO-week}.md` (per-project, not `~/.config/pi/memory/notes/`). Use `findProjectRoot()` (or walk up looking for `package.json`) before writing project-scoped files.

## Edit Protocol

1. **LOCATE** — find exact position of what must change
2. **READ** — get fresh file content around the target
3. **VERIFY** — confirm expected content exists
4. **PREPARE** — copy the exact oldText from the read output (byte-perfect, including whitespace)
5. **EDIT** — precise replacement with unique surrounding context
6. **CONFIRM** — read back the result
7. **ORPHANS** — remove imports/variables/functions your changes made unused. Don't touch pre-existing dead code.

Steps 2, 3, and 4 are never optional. Reading from memory, grep summary, or assumed content does not satisfy READ.

On edit failure: re-read the target lines with offset/limit to get exact whitespace, then retry. If 2 consecutive edits fail on the same target, escalate.

If the edit tool rejects oldText due to JSON syntax conflicts (e.g. `:` inside template literals like `${$.repeat(n)}`), use `bash sed` instead of the edit tool.

## Verification Before Completion

- Run typecheck / lint / test / build after meaningful changes.
- If you create or modify a test file, run that test file directly and iterate until it passes.
- If verification fails twice on the same approach, stop and escalate.
- Auto-detect project toolchain — look for `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Makefile`, etc.

## Constraints

| Concern       | Rule                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------- |
| Security      | Never expose or invent credentials                                                       |
| Git safety    | Never force push main/master; never bypass hooks                                         |
| Git restore   | Never `reset --hard`, `checkout .`, `clean -fd` without explicit request                 |
| Honesty       | Never fabricate tool output; never guess URLs; label inferences                          |
| Paths         | Use absolute paths for file operations                                                   |
| Search        | Dedicated `grep` tool is allowed; never run shell `grep` in `bash`, use `rg`             |
| Reversibility | Ask first before destructive or irreversible actions                                     |
| TODO tracking | For multi-step work, write `TODO.md` inside `.pi/artifacts/<id>/` per the Artifacts rule |

## Effort Signal

When proposing work, include effort: **S** (<1h), **M** (1-3h), **L** (1-2d), **XL** (>2d).

## Anti-Patterns

| If you see...                                         | Apply...                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Silent assumption                                     | Clarify before committing                                                                                          |
| Over-engineered solution                              | Choose the smallest working change                                                                                 |
| Noisy diff (style drift, drive-by refactors)          | Keep diffs surgical                                                                                                |
| Vague completion claim                                | Define proof before acting                                                                                         |
| Dead code after your edits                            | ORPHANS step in Edit Protocol                                                                                      |
| `observation` used as a chat log / build-warning dump | Apply Memory hygiene (Core Operating Principles) — reserve `observation` for decisions, patterns, bugs, learnings. |
