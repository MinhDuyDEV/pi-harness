---
description: Create a well-structured commit from staged or unstaged changes
argument-hint: "[--all] [--amend] [message override]"
---

# Commit: $ARGUMENTS

Create a well-structured conventional commit from current changes.

## Load Skills

```typescript
skill({ name: "git-workflow-and-versioning" });
```

## Process

### Phase 1: Inspect Changes

```bash
git status --porcelain
git diff --stat
git diff --cached --stat
```

### Phase 2: Analyze

- Identify the type of change:
  - `feat`: New feature or capability
  - `fix`: Bug fix
  - `refactor`: Code restructuring (no behavior change)
  - `test`: Test-only changes
  - `chore`: Config, tooling, dependencies
  - `docs`: Documentation only

- Determine scope from changed files (e.g., `auth`, `api`, `ui`)
- Summarize what changed and why

### Phase 3: Stage

If nothing is staged (`git diff --cached` is empty):

- Stage specific files relevant to the change (never `git add .`)
- Group related changes into one logical commit
- Leave unrelated changes unstaged

### Phase 4: Commit

Format: `type(scope): concise description`

Rules:
- Subject line: max 72 chars, imperative mood ("add" not "added")
- Body: explain WHY, not WHAT (the diff shows what)
- Reference issue/bead IDs if applicable
- No emoji in commit messages

```bash
git commit -m "type(scope): description" -m "body (optional)"
```

### Phase 5: Confirm

```bash
git log --oneline -1
git diff --stat HEAD~1
```

## Options

- `--all`: Stage all modified tracked files before committing
- `--amend`: Amend the previous commit instead of creating new
- Free text: Use as the commit message directly
