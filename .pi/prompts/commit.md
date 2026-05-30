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
  - `feat`: new feature or capability
  - `fix`: bug fix
  - `refactor`: code restructuring without behavior change
  - `test`: test-only changes
  - `chore`: config, tooling, dependencies
  - `docs`: documentation only
- Determine scope from changed files.
- Summarize what changed and why.
- Reference issue IDs or `.pi/plans/<id>/` work IDs when applicable.

### Phase 3: Stage

If nothing is staged:

- Stage specific files relevant to this logical change.
- Never use `git add .` or `git add -A`.
- Leave unrelated changes unstaged.

### Phase 4: Commit

Format: `type(scope): concise description`

Rules:

- Subject line: max 72 chars, imperative mood.
- Body: explain why, not what.
- No emoji.
- Do not bypass hooks.

```bash
git commit -m "type(scope): description" -m "body (optional)"
```

### Phase 5: Confirm

```bash
git log --oneline -1
git diff --stat HEAD~1
```

## Options

- `--all`: Stage all modified tracked files only after showing the exact list and confirming scope.
- `--amend`: Amend the previous commit instead of creating a new one.
- Free text: Use as the commit message directly.
