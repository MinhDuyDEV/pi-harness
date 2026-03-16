---
description: Generate a pull request description from current branch changes
argument-hint: "[base-branch] [--draft]"
---

# PR: $ARGUMENTS

Generate a comprehensive pull request description from branch changes.

## Process

### Phase 1: Gather Context

```bash
git branch --show-current
git log --oneline main..HEAD 2>/dev/null || git log --oneline master..HEAD
git diff --stat main..HEAD 2>/dev/null || git diff --stat master..HEAD
```

### Phase 2: Analyze Changes

- Read the diff to understand all changes
- Group changes by area (feature, fix, refactor, test, config)
- Identify the primary purpose of the branch
- Note any breaking changes

### Phase 3: Generate PR Description

Format:

```markdown
## Summary

[1-2 sentence overview of what this PR does and why]

## Changes

- [Change 1]: [brief description]
- [Change 2]: [brief description]
- ...

## Testing

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing: [describe what was tested]

## Breaking Changes

[None, or describe what breaks and migration path]

## Screenshots

[If UI changes, note where screenshots should go]
```

### Phase 4: Output

Print the PR description in a code block for easy copy-paste.

If `--draft` is specified, note this should be created as a draft PR.

## Rules

- Be specific about what changed, not vague
- Mention file paths for significant changes
- Include testing evidence from verification runs
- Link to related issues/beads if applicable
