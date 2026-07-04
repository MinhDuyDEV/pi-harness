---
name: superpi
description: Use when starting any conversation - establishes how to find and use skills, requiring skill invocation before ANY response
---

# SuperPi — Skill Loading

## When to Use

Start of any conversation before any response is given. The protocol: "I have skills X, Y, Z available. Which should I load for this task?" Not "I'll figure out what to use."

## When NOT to Use

Already loaded the right skill; the user is asking for a direct action; trivial one-off question.

## The Protocol

1. **User states a request.**
2. **Agent responds: "I can load [skill list]. Which skill(s) should I use?"**
3. **User picks.**
4. **Agent loads the skill and proceeds.**

Step 2 is mandatory. The agent does not guess which skill to load. The agent does not proceed without an answer.

## Skill Sources

| Source | Location | Load behavior |
|---|---|---|
| Global | `~/.pi/skills/` | Available in all projects (don't use) |
| Project | `.pi/skills/` | Available in this project |
| Per-session | Loaded by skill command | Temporary |

Project skills are loaded automatically by directory scan. Per-session skills are loaded by the `[skill:name]` command.

## "Skills You Reach For First"

- `development-lifecycle` — starting / planning / shipping / verifying
- `artifact-format` — non-trivial task tracking (>2 tool calls, >2 files)
- `brainstorming` — refining rough ideas
- `planning-and-task-breakdown` — executable plan from a spec
- `writing-skills` — creating / editing / testing skills
- `code-review-and-quality` — before merge or after subagent work
- `debugging-and-error-recovery` — when something breaks
- `diagnose` — for hard bugs

## When to Auto-Load

| Trigger | Skill |
|---|---|
| "Start a new feature" | `development-lifecycle` + `planning-and-task-breakdown` |
| "I have an idea" | `brainstorming` |
| "Fix this bug" | `debugging-and-error-recovery` or `diagnose` |
| "Review this" | `code-review-and-quality` |
| "Compress skills" | `writing-skills` (TDD for skill changes) |
| "Add tests" | `test-driven-development` |

## Common Mistakes

Loading a skill without asking the user; skipping the protocol; "I'll load the right skill later"; loading too many skills (context bloat); loading the wrong skill for the task; not knowing which skill to load; assuming a skill exists for a task (check first); loading a skill that's too specific (context waste).

## Red Flags

Agent loading skills without asking; "later" loading (skills needed NOW); 5+ skills loaded in one response (context bloat); wrong skill for the task; not checking if a skill exists; assuming generic task needs a specific skill; "I'll figure out what to use" (no, ask).

## Anti-Patterns

**No ask** (load without permission); **"later"** (now); **5+ skills at once** (context bloat); **wrong skill**; **not checking**; **assume not ask**; **"figure out"** (ask).
