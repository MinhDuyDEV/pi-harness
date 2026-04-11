---
description: Create and submit pull request with bead traceability
argument-hint: "[bead-id] [--draft]"
---

# Pull Request

## Load Skills

```typescript
skill({ name: "beads" });
skill({ name: "memory-grounding" });
skill({ name: "verification-gates" });
skill({ name: "verification-before-completion" });
```

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

Follow the [verification-gates](../skill/verification-gates/SKILL.md) skill protocol. All gates must pass before creating the PR.

Check `package.json` scripts, `Makefile`, or `justfile` for project-specific commands first — prefer those over generic defaults.

If any gate fails, stop. Fix errors first, then run `/pr` again.

## Phase 2: Gather Context

### Memory Grounding

Follow the [memory-grounding](../skill/memory-grounding/SKILL.md) skill protocol. Include relevant findings in the PR description.

### Git Context

```bash
git branch --show-current
git log main...HEAD --oneline
git diff main...HEAD --stat
```

If bead ID provided:

```bash
br show $ARGUMENTS
```

Read `.beads/artifacts/$ARGUMENTS/` to check what artifacts exist.

Read the PRD to extract goal and success criteria for the PR description.

## Phase 2B: Pre-PR Review

This is the last gate before code hits GitHub. Run it every time.

Load the review skill:

```typescript
skill({ name: "requesting-code-review" });
```

Run **5 parallel agents**: security/correctness, performance/architecture, type-safety/tests, conventions/patterns, simplicity/completeness.

```bash
BASE_SHA=$(git rev-parse origin/main 2>/dev/null || git merge-base HEAD origin/main)
HEAD_SHA=$(git rev-parse HEAD)
```

Fill placeholders:

- `{WHAT_WAS_IMPLEMENTED}`: what this PR delivers (from git log summary)
- `{PLAN_OR_REQUIREMENTS}`: PRD path or brief requirements
- `{BASE_SHA}` / `{HEAD_SHA}`: from above

**Gate rule:** All Critical issues must be resolved before pushing. No exceptions.
Important issues: fix or document as known limitation in PR body.

After fixing issues, re-run verification gates from Phase 1 if code was changed.

## Phase 3: Push and Confirm

Show what will be pushed and ask the user:

```typescript
question({
  questions: [
    {
      header: "Push",
      question: "Ready to push and create PR. Proceed?",
      options: [
        { label: "Push & create PR (Recommended)", description: "Push branch and create PR" },
        { label: "Push & draft PR", description: "Create as draft for review" },
        { label: "Show diff first", description: "Review changes before pushing" },
      ],
    },
  ],
});
```

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

If bead ID provided, add artifacts section linking to `.beads/artifacts/$ARGUMENTS/prd.md`.

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
