# Git hygiene and versioning

Treat commits as verified, reversible save points. Before editing a shared dirty
worktree, run `git status --short`, identify unrelated changes, and preserve
them.

## Atomic workflow

1. One intent per diff and one verification story per commit.
2. Prefer short-lived trunk-based branches and frequent integration.
3. Stage explicit files only; never use broad `git add .` in a mixed worktree.
4. Keep generated/cache files out unless they are intentional release artifacts.
5. Update the smallest required version/changelog/migration surface.
6. Before shipping, report status, diff summary, verification commands, and the
   rollback path.

Version bumps require a release rationale and changelog entry. A rollback may
need more than `git revert` when migrations, queues, feature flags, or external
state are involved. Do not claim a clean tree without checking it.

