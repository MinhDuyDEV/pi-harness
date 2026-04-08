---
description: Create user profile for personalized AI interactions
argument-hint: "[--skip-questions]"
---

# Init-User: $ARGUMENTS

Create personalized user profile. Optional but recommended for better AI responses.

> **Prerequisite:** Run `/init` first for core setup
> **Related:** `/init-context` for project planning setup

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

Write to memory system:

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

Store key preferences as a memory observation for cross-session retrieval:

```
observation(
  type: "decision",
  title: "User profile: [name]",
  narrative: "User preferences captured: [style], [workflow prefs], [technical prefs].",
  concepts: "user-profile, preferences",
  confidence: "high"
)
```

## Phase 3: Report

Output:

1. user.md created
2. Preferences captured
3. Next step: `/init-context` for project planning setup
