---
name: ci-cd-and-automation
description: Designs CI/CD pipelines — GitHub Actions, caching, secrets, matrix builds, release automation. Use when editing workflow YAML, when CI is slow, when secrets risk leaking, or when wiring deploy jobs.
metadata:
  version: 1.0.0
  tags:
  - devops
  - workflow
  dependencies: []
---

# CI/CD & Automation

## Iron Laws

<EXTREMELY-IMPORTANT>
- **CI runs on every PR.** No exceptions. PRs without green CI do not merge.
- **Main is always deployable.** If main is broken, team is blocked. Fix or revert.
- **Cache dependencies, not source.** Key on lockfile. 90% of CI is install.
- **Secrets via platform store.** Never in workflow YAML. Never in logs.
- **Fast feedback.** 5-min CI > 30-min CI.
</EXTREMELY-IMPORTANT>

## When to Use

Setting up CI for a new project; adding a job (lint, typecheck, test, security, build, deploy); caching slow steps; secrets in CI; release workflow (semver, changelog, npm publish); matrix builds; deploy previews.

## When NOT to Use

Manual deploys (CI is the answer); one-off scripts (use Make or just); long-running batch jobs (use a queue, not CI); a workflow that runs > 30 min (split it).

## Pipeline Anatomy

```
[Trigger] → [Setup + Cache] → [Lint] → [Typecheck] → [Test] → [Build] → [Deploy]
```

When one step dominates total runtime, split it into a separate parallel job instead of growing a single serial pipeline.

## Caching

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.npm
      node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
```

Key on the lockfile hash, restore-key as fallback. Cache the install dir, not the source.

## Secrets

```yaml
- name: Deploy
  env:
    API_TOKEN: ${{ secrets.API_TOKEN }}
  run: ./deploy.sh
```

`secrets.*` in env. Never `echo` the secret. Never `set -x` with secrets. Use `::add-mask::` if a secret might leak.

## Matrix Builds

```yaml
strategy:
  matrix:
    node: [18, 20, 22]
    os: [ubuntu-latest, macos-latest]
```

Don't test dead versions. Update when the floor moves.

## Deploy Strategies

| Strategy | When |
|---|---|
| Rolling | Default for most services |
| Blue/green | Zero-downtime, canary-able |
| Canary | Small % of traffic, ramp |
| Recreate | Acceptable downtime, stateless |

## Release Workflow

```
PR merge → [CI: tests + build] → [Release: bump version] → [Publish] → [Deploy]
```

Use release-please or similar. Manual bumps = drift = bugs.

## Red Flags

CI only on main (bugs caught late); no cache (5+ min install); secrets visible in logs; one giant serial job; "skip ci" used to bypass checks; full deploy on every PR (use previews); no artifact upload; matrix with dead versions; manual release bumps; flaky tests not quarantined; no failure notifications; "the CI is broken, just push to main".
