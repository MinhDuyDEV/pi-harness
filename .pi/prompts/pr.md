---
description: Create and submit pull request with bead traceability and pre-PR review
argument-hint: "[bead-id] [--draft]"
---

# Pull Request: $ARGUMENTS

## Parse Arguments

| Argument    | Default  | Description        |
| ----------- | -------- | ------------------ |
| `<bead-id>` | optional | Link PR to bead    |
| `--draft`   | false    | Create as draft PR |

## Phase 1: Pre-PR Verification

```bash
git status --porcelain
```

If uncommitted changes exist, ask whether to commit first.

Run verification gates — all must pass before creating the PR:

- Check `package.json` scripts, `Makefile`, or `justfile` for project-specific commands
- Run typecheck, lint, test as appropriate
- If any gate fails, stop. Fix errors first, then run `/pr` again.

## Phase 2: Gather Context

```bash
git branch --show-current
git log main...HEAD --oneline
git diff main...HEAD --stat
```

If bead ID provided:

```bash
br show $ARGUMENTS
```

Read bead artifacts to extract goal and success criteria for the PR description.

## Phase 2B: Pre-PR Review

This is the last gate before code hits GitHub. Run it every time.

Run **parallel review agents** covering: security/correctness, performance/architecture, type-safety/tests, conventions/patterns, simplicity/completeness.

```bash
BASE_SHA=$(git rev-parse origin/main 2>/dev/null || git merge-base HEAD origin/main)
HEAD_SHA=$(git rev-parse HEAD)
```

**Gate rule:** All Critical issues must be resolved before pushing. No exceptions.
Important issues: fix or document as known limitation in PR body.

After fixing issues, re-run verification gates from Phase 1 if code was changed.

## Phase 3: Push and Confirm

Show what will be pushed and confirm with the user before proceeding.

If confirmed:

```bash
git push -u origin $(git branch --show-current)
```

## Phase 4: Create PR

```bash
# Verify gh CLI is installed
command -v gh >/dev/null 2>&1 || { echo "Error: gh CLI not found. Install: https://cli.github.com"; exit 1; }

gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary

[1-2 sentences: what this PR does and why]

## Changes

- `file.ts`: [what changed]
- `other.ts`: [what changed]

## Testing

- All tests pass
- Lint and typecheck pass
- Manual verification: [how to test]

## Checklist

- [x] Tests added/updated
- [x] All gates pass
- [ ] Docs updated (if applicable)
EOF
)"
```

If `--draft`, add `--draft` flag.
If bead ID provided, add artifacts section linking to PRD.

## Output

Report:

1. PR URL
2. Status (Ready for Review / Draft)
3. Branch → main
4. Gate results

## Related Commands

| Need         | Command        |
| ------------ | -------------- |
| Ship first   | `/ship <id>`   |
| Verify first | `/verify <id>` |
