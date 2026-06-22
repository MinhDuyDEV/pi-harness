---
name: development-lifecycle
description: Use when starting, planning, shipping, or verifying a work session — describes how `/create`, `/plan`, `/ship`, `/verify`, and `/research` interact with the 4 canonical artifact files at `.pi/artifacts/`.
version: 2.0.0
tags: [workflow, artifacts, planning, work-sessions]
agent_types: [planner, worker, reviewer, scout]
tools: [read, write, edit, grep, bash]
---

# Development Lifecycle

Work sessions go through up to 5 phases: research (optional), create, plan, ship, verify. Each phase updates a `### YYYY-MM-DD - <title>` block in the 4 canonical artifact files at `.pi/artifacts/`. No subdirectories, no per-work-id filenames. The block is the unit of work.

## The 4 Canonical Files

| File | Purpose | Work Session Content |
| --- | --- | --- |
| `TODO.md` | Status + checkboxes | Top-level block, status, step checkboxes |
| `PLAN.md` | Spec + plan | `#### Spec`, `#### Plan`, `#### Phases` |
| `PROGRESS.md` | Run log + review + verify + research | `#### Run Report`, `#### Review`, `#### Verification`, `#### Research` |
| `DECISIONS.md` | ADRs + design | `#### ADR NNN: <title>` |

## Block Format

Each work session has a block in each canonical file it touches:

```markdown
### YYYY-MM-DD - <title>
status: active | updated: YYYY-MM-DD

#### Spec
<spec content>
```

Subsections (`####`) within a block hold phase-specific content. H4 is the only level used inside blocks; H3 is for the block heading.

## Phase → File Mapping

| Phase | Slash command | Updates |
| --- | --- | --- |
| Research (optional) | `/research <topic> --into=<title>` | `PROGRESS.md` (add `#### Research`) |
| Create | `/create <title>` | `TODO.md` (new block), `PLAN.md` (add `#### Spec`) |
| Plan | `/plan <title>` | `PLAN.md` (add `#### Plan`, `#### Phases`), `TODO.md` (expand checkboxes), `DECISIONS.md` (ADRs) |
| Ship | `/ship <title>` | `TODO.md` (check off steps), `PROGRESS.md` (add `#### Run Report`, `#### Review`) |
| Verify | `/verify <title>` | `PROGRESS.md` (add `#### Verification`), update status to done in `TODO.md` and `PLAN.md` |

## Finding the Work Session

A work session is identified by its title. To find it across the 4 files:

```bash
rg "^### .* - <title>$" .pi/artifacts/{TODO,PLAN,PROGRESS,DECISIONS}.md
```

The blocks share the same `### YYYY-MM-DD - <title>` heading so anchors are consistent across files.

To see all in-flight work:

```bash
rg "^status: active" .pi/artifacts/{TODO,PLAN,PROGRESS,DECISIONS}.md
```

## Cross-References

Use the heading anchor in cross-references between files and work sessions:

    The spec for my-work is in PLAN.md#2026-06-25-my-work
    The run report is in PROGRESS.md#2026-06-25-my-work

## Concurrency

The parent agent owns the canonical files. Slash commands are run by the parent (or the user invoking them). Subagents (`task`, `harness`) return proposed block content; the parent writes it.

## Status Lifecycle

```
status: active    → work in progress
status: done      → phase complete; the work session has shipped and verified
status: abandoned → work stopped without completion; record the reason in the block
```

Update `status:` and `updated:` on every transition. The block stays in place — do not move, hide, or archive.

## Composition with Direct-Tool Work

Direct-tool work (single fix, one-line edit, throwaway script) uses the same canonical files but does not go through a slash command. The artifact format is the same; the difference is whether a work session block exists in `TODO.md` (planned) or only in `PROGRESS.md` (executed).

A direct-tool task that grows in scope can be promoted to a work session: create the `TODO.md` block, write a `#### Spec` in `PLAN.md`, and continue from there.

## Related Skills

| Skill | Use for |
| --- | --- |
| `artifact-format` | The block format itself; this skill is the lifecycle on top of it |
