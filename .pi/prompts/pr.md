---
description: Create and submit a pull request with file-backed work traceability
argument-hint: "[work-id] [--draft]"
---

# Pull Request: $ARGUMENTS

Create a pull request after verification and review gates pass.

## Load Skills

```typescript
skill({ name: "memory-system" });
skill({ name: "code-review-and-quality" });
skill({ name: "verification-before-completion" });
skill({ name: "git-workflow-and-versioning" });
```

## Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<work-id>` | optional | Link PR to `.pi/plans/<id>/` artifacts |
| `--draft` | false | Create as draft PR |

## Phase 1: Pre-PR Verification

```bash
git status --porcelain
git branch --show-current
git diff --stat
git diff --cached --stat
```

If uncommitted changes exist, ask whether to commit first. Do not stage broad changes automatically.

Run `verification-before-completion` and `code-review-and-quality`. All critical issues and required gates must pass before pushing.

Check project-native commands first: `package.json`, `Makefile`, `justfile`, `Cargo.toml`, `pyproject.toml`, `go.mod`.

## Phase 2: Gather Context

```bash
git branch --show-current
git log main...HEAD --oneline 2>/dev/null || git log --oneline -10
git diff main...HEAD --stat 2>/dev/null || git diff --stat
```

If a work ID is provided and `.pi/plans/$ARGUMENTS/` exists, read:

- `SPEC.md`
- `PLAN.md`
- `VERIFICATION.md`
- `RUN-REPORT.md`

Use these to summarize goal, scope, and test evidence.

## Phase 3: Pre-PR Review

Review the diff one final time:

```bash
BASE_SHA=$(git rev-parse origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || git rev-parse HEAD~1)
HEAD_SHA=$(git rev-parse HEAD)
git diff "$BASE_SHA"..."$HEAD_SHA" --stat 2>/dev/null || git diff --stat
```

Gate rule: all Critical issues must be resolved before pushing. Important issues must be fixed or documented in the PR body.

After fixes, re-run verification gates for changed files.

## Phase 4: Push Confirmation

Ask before pushing:

```typescript
ask_user_question({
  questions: [
    {
      header: "Push",
      question: "Ready to push and create PR. Proceed?",
      options: [
        { label: "Push & create PR (Recommended)", description: "Push branch and create PR" },
        { label: "Push & draft PR", description: "Create as draft for review" },
        { label: "Show diff first", description: "Review changes before pushing" },
      ],
      multiSelect: false,
    },
  ],
});
```

If confirmed:

```bash
git push -u origin $(git branch --show-current)
```

## Phase 5: Create PR

```bash
command -v gh >/dev/null 2>&1 || { echo "Error: gh CLI not found. Install: https://cli.github.com"; exit 1; }

gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary

[1-2 sentences: what this PR does and why]

## Changes

- `path/to/file`: [what changed]

## Testing

- [command]: [result]

## Artifacts

- Spec: `.pi/plans/<id>/SPEC.md` (if applicable)
- Verification: `.pi/plans/<id>/VERIFICATION.md` (if applicable)

## Checklist

- [x] Tests added/updated where needed
- [x] Verification gates pass
- [x] Review completed
- [ ] Docs updated if applicable
EOF
)"
```

If `--draft` is present or the user selected draft, add `--draft`.

## Output

Report:

1. PR URL.
2. Status: ready or draft.
3. Branch and base.
4. Gate results.
5. Linked `.pi/plans/<id>/` artifacts if applicable.

## Related Commands

| Need | Command |
| --- | --- |
| Ship first | `/ship <id>` |
| Verify first | `/verify <id>` |
