# Task Creation

## When to Create Tasks

Create tasks when:

- User mentions tracking work across sessions
- User says "we should fix/build/add X"
- Work has dependencies or blockers
- Discovered work while implementing (>2 min effort)

## Basic Task Creation

```bash
br create --title "Fix authentication bug" --priority 0 --type bug
# Priority: 0=critical, 1=high, 2=normal, 3=low, 4=backlog
# Types: task, bug, feature, epic, chore
```

## With Description

```bash
br create --title "Implement OAuth" --type feature --priority 1 \
  --description "Add OAuth2 support for Google, GitHub. Use passport.js."
```

## Epic with Children

```bash
# Create parent epic
br create --title "Epic: OAuth Implementation" --priority 0 --type epic
# Returns: oauth-abc

# Create child tasks with parent
br create --title "Research OAuth providers" --priority 1 --parent oauth-abc
br create --title "Implement auth endpoints" --priority 1 --parent oauth-abc
br create --title "Add frontend login UI" --priority 2 --parent oauth-abc
```
