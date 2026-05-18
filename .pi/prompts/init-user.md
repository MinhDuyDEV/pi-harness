---
description: Create user profile for personalized AI interactions
argument-hint: "[--skip-questions]"
---

# Init-User: $ARGUMENTS

Create personalized user profile. Optional but recommended for better AI responses.

> **Prerequisite:** Run `/init` first for core setup
> **Related:** `/init-context` for project planning setup

## Load Skills

```typescript
skill({ name: "memory-system" });
```

## Options

| Argument           | Default | Description                         |
| ------------------ | ------- | ----------------------------------- |
| `--skip-questions` | false   | Infer from git config, skip prompts |

## Phase 1: Gather Preferences

Unless `--skip-questions`, ask in one message:

1. **Identity**: "Which git contributor are you?" (show top 5 from `git shortlog -sn --all`)
2. **Communication**: "Terse or detailed responses?"
3. **Workflow**: "Auto-commit or ask-first?"
4. **Rules**: "Any rules I should always follow?"
5. **Technical**: "Preferred languages/frameworks?"

If skipped, infer from `git config user.name` and `git config user.email`.

## Phase 2: Create user.md

From template `.pi/memory/_templates/user.md`:

```bash
cp .pi/memory/_templates/user.md .pi/memory/project/user.md
```

Fill in gathered answers:

```markdown
---
purpose: User identity, preferences, communication style
updated: [today]
---

# User Profile

## Identity

- Name: [from answers]
- Git email: [user.email]

## Communication Preferences

- Style: [Terse/Detailed]
- Tone: [Professional/Casual]

## Workflow Preferences

- Git commits: [Auto/Ask-first]
- Beads updates: [Auto/Ask-first]

## Technical Preferences

- Languages/frameworks: [Preferred languages/frameworks]

## Things to Remember

- [Rule 1]
- [Rule 2]
- [Rule 3]
```

### Persist to Memory System

After writing the file, also store key preferences as a memory observation for cross-session retrieval:

```typescript
observation({
  type: "decision",
  title: "User profile: [name]",
  narrative: "User preferences captured: [style], [workflow prefs], [technical prefs]. Source: /init-user command.",
  concepts: "user-profile, preferences",
  confidence: "high",
  files_modified: ".pi/memory/project/user.md",
});
```

## Phase 3: Update `.pi/settings.json`

Ensure `user.md` is loaded in `.pi/settings.json` `instructions` (bare paths, no `file://` prefix).

The default `instructions[]` includes 4 auto-injected files:

```json
{
  "instructions": [
    ".pi/memory/project/user.md",
    ".pi/memory/project/tech-stack.md",
    ".pi/memory/project/project.md",
    ".pi/context/git-context.md"
  ]
}
```

> **Warning:** Do not add more files to `instructions[]` unless they are essential for every prompt. Per-prompt injection of too many files causes session OOM crashes. Use `memory-search({ file: "..." })`` for on-demand access instead.

## Phase 4: Report

Output:

1. user.md created at `.pi/memory/project/user.md`
2. Preferences captured
3. 4 files are auto-injected by default: user.md, tech-stack.md, project.md, git-context.md
4. Additional planning files (roadmap.md, state.md) are on-demand via `/init-context`
5. Custom context available at `.pi/context/` (preserved during init --force and upgrade)
6. Next step: `/init-context` if the user wants fuller project-planning memory files
