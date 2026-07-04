---
name: using-pikit-skills
description: Use when starting any conversation - establishes how to find and use skills, requiring skill invocation before ANY response
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, ignore this skill.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

This is not negotiable. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

## The Rule

**Invoke relevant or requested skills BEFORE any response or action** — including clarifying questions, exploring the codebase, or checking files. If it turns out wrong for the situation, you don't have to use it.

**Before entering plan mode:** if you haven't already brainstormed, invoke the `brainstorming` skill first.

Then announce "Using [skill] to [purpose]" and follow the skill exactly. If it has a checklist, create a todo per item.

## Skill Priority

When multiple skills apply, process skills come first — they set the approach, then implementation skills carry it out.

- "Let's build X" → `brainstorming` first, then `prototype` or `planning-and-task-breakdown`.
- "Fix this bug" → `debugging-and-error-recovery` (or `diagnose` for hard bugs) first, then domain skills.
- "Write a skill" → `writing-skills` first.
- "Review code" → `code-review-and-quality` or `reviewer` subagent first.
- "Before implementation" → check for `implementation-notes.md` next to artifacts; log Deviations/Discoveries per `artifact-format`.

## Red Flags

These thoughts mean STOP — you're rationalizing:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git/files quickly" | Files lack conversation context. Check for skills. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "I know what that means" | Knowing the concept ≠ using the skill. Invoke it. |

## Pi Tool Mapping

Pi has native skills but does not expose a `Skill` tool. When a skill instruction says to "invoke the skill" or "use the X skill":

- Load the relevant `SKILL.md` with the `read` tool when the skill applies.
- The user can also invoke `/skill:name` explicitly.

Pi's built-in coding tools: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`, `hashline_read`, `hashline_edit`.

For subagent dispatch: if a subagent tool (`pi-subagents` or similar) is available, use it. Otherwise do the work in this session or explain the missing capability instead of inventing calls.

For task tracking: if an installed todo/task tool is available, use it. Otherwise track work in plan files or a repo-local `TODO.md` when task tracking is needed.

## User Instructions

User instructions (`.pi/AGENTS.md`, `.pi/APPEND_SYSTEM.md`, direct requests) take precedence over skills, which in turn override default behavior. Only skip skill workflows when the user has explicitly told you to.

## The skills you reach for first

These cover most tasks; the rest of the 76-skill catalog is domain-specific (cloudflare, supabase, swiftui, etc.).

- **`development-lifecycle`** — the whole arc. Read once.
- **`artifact-format`** — TODO/PLAN/PROGRESS/DECISIONS lifecycle. Use on any non-trivial task.
- **`brainstorming`** — before any creative work.
- **`planning-and-task-breakdown`** — once you have a spec, decompose into tasks.
- **`writing-skills`** — when adding or editing a skill.
- **`code-review-and-quality`** — before merge.
- **`debugging-and-error-recovery`** / **`diagnose`** — when something is broken.
- **`verification-before-completion`** — before claiming done.
