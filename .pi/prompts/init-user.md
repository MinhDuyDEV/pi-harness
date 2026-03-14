---
description: Create user profile for personalized AI interactions
---

# Init-User: $@

Create personalized user profile. Optional but recommended for better AI responses.

> **Prerequisite:** Run `/init` first for core setup
> **Related:** `/init-context` for project planning setup

## Options

| Argument           | Default | Description                         |
| ------------------ | ------- | ----------------------------------- |
| `--skip-questions` | false   | Infer from git config, skip prompts |

## Phase 1: Gather Preferences

Unless `--skip-questions`, ask the user these questions in a single message:

1. **Identity**: "Which git contributor are you?" (show top 5 from `git shortlog -sn --all`)
2. **Communication**: "Terse or detailed responses?"
3. **Workflow**: "Auto-commit or ask-first?"
4. **Rules**: "Any rules I should always follow?"
5. **Technical**: "Preferred languages/frameworks?"

If `--skip-questions`, infer identity from git config:

```bash
git shortlog -sn --all | head -5
git config user.name
git config user.email
```

## Phase 2: Create user.md

Create `.pi/user.md` with gathered answers:

```markdown
---
purpose: User identity, preferences, communication style
updated: [today]
---

# User Profile

## Identity

- **Name:** [from answers]
- **Git:** [user.name] <[user.email]>

## Communication Preferences

- **Style:** [Terse/Detailed]
- **Tone:** [Professional/Casual]

## Workflow Preferences

- **Commits:** [Auto/Ask-first]
- **Beads updates:** [Auto/Ask-first]

## Technical Preferences

- **Languages:** [Preferred languages]
- **Frameworks:** [Preferred frameworks]

## Rules to Always Follow

- [Rule 1]
- [Rule 2]
- [Rule 3]
```

## Phase 3: Reference in APPEND_SYSTEM.md

If `.pi/APPEND_SYSTEM.md` exists, suggest adding a reference to user.md:

```markdown
## User Preferences

See `.pi/user.md` for user identity, communication style, and workflow preferences.
Always check this file at the start of a session.
```

Otherwise, note that the user profile exists at `.pi/user.md` and suggest reading it at session start.

## Phase 4: Report

Output:

1. user.md created at `.pi/user.md`
2. Preferences captured
3. Next step: `/init-context` for GSD planning workflow
