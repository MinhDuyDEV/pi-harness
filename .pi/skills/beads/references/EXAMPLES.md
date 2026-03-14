# Examples

## Example 1: Standard Session

```bash
# 1. Find and claim work
br ready
br update auth-123 --status in_progress

# 2. Get context
br show auth-123

# 3. Do the work...
# [implementation]

# 4. Complete and sync
br close auth-123 --reason "Login form with validation, hooks for auth state"
br sync --flush-only
git add .beads/
git commit -m "close auth-123"
# RESTART SESSION
```

## Example 2: Discovered Work

```bash
# Working on task, found more work
br create --title "Fix edge case in validation" --type bug --priority 1 \
  --description "Empty strings bypass email check - discovered while implementing login"
# Continue current task, new task tracked for later
```

## Example 3: Creating Dependencies

```bash
# Create tasks with dependencies
br create --title "Setup database" --type task --priority 1
# Returns: setup-db

br create --title "Implement API" --type task --priority 2 --blocked-by setup-db
# Returns: impl-api (blocked until setup-db closes)

br create --title "Add tests" --type task --priority 2 --blocked-by impl-api
# Returns: add-tests
```
