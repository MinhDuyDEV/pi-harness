---
name: ci-cd-and-automation
description: Use when setting up CI/CD pipelines, GitHub Actions workflows, automated testing in CI, or deployment automation — covers pipeline design, caching, secrets management, and release workflows
version: 1.0.0
tags: [devops, workflow]
dependencies: []
---

# CI/CD & Automation

> **Replaces** manual deployment checklists and ad-hoc scripts with repeatable, auditable automation pipelines

## When to Use

- Setting up or modifying CI/CD pipelines (GitHub Actions, GitLab CI, etc.)
- Adding automated testing, linting, or type-checking to a repository
- Configuring deployment automation or release workflows
- Optimizing CI performance (caching, parallelism, conditional runs)

## When NOT to Use

- Local development scripts (use Makefile or package.json scripts)
- One-time migration scripts that don't repeat
- Infrastructure provisioning (use infrastructure-as-code tools directly)

## Overview

CI/CD pipelines are the quality gates between code and production. A well-designed pipeline catches problems early, runs fast, and deploys safely.

**Core principle:** Every step that a human does manually before merging or deploying should be automated in the pipeline. If it can be automated, it must be.

## Pipeline Design

### Verification Pipeline (PR/Push)

```yaml
# Ordered by speed: fastest gates first
steps:
  1. Lint          # seconds — catches formatting/style issues
  2. Typecheck     # seconds — catches type errors
  3. Unit tests    # seconds-minutes — catches logic bugs
  4. Build         # minutes — catches compilation issues
  5. Integration   # minutes — catches integration bugs
  6. E2E tests     # minutes — catches user-facing bugs (optional per-PR)
```

**Fail-fast rule:** Run cheapest checks first. Don't waste 10 minutes on E2E tests if linting fails in 5 seconds.

### Deployment Pipeline (Main/Release)

```
1. All verification steps pass
2. Build production artifacts
3. Deploy to staging
4. Run smoke tests against staging
5. Deploy to production (manual gate or auto)
6. Run smoke tests against production
7. Monitor error rates for rollback window
```

## GitHub Actions Patterns

### Basic PR Verification

```yaml
name: verify
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: ".node-version"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

### Caching Strategy

| What         | Cache Key         | Restore Key | Impact       |
| ------------ | ----------------- | ----------- | ------------ |
| Dependencies | `lockfile hash`   | `os-deps-`  | 30-60s saved |
| Build output | `source hash`     | `os-build-` | 1-5min saved |
| Test cache   | `test files hash` | `os-test-`  | Variable     |

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.pnpm-store
    key: ${{ runner.os }}-pnpm-${{ hashFiles('**/pnpm-lock.yaml') }}
    restore-keys: ${{ runner.os }}-pnpm-
```

### Parallel Jobs

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps: [checkout, setup, "pnpm lint"]

  typecheck:
    runs-on: ubuntu-latest
    steps: [checkout, setup, "pnpm typecheck"]

  test:
    runs-on: ubuntu-latest
    steps: [checkout, setup, "pnpm test"]

  build:
    needs: [lint, typecheck, test] # Only build after all checks pass
    runs-on: ubuntu-latest
    steps: [checkout, setup, "pnpm build"]
```

## Secrets Management

| Rule                                       | Reason                                        |
| ------------------------------------------ | --------------------------------------------- |
| Never echo secrets in CI logs              | Logs are often accessible to all contributors |
| Use GitHub Secrets / environment variables | Encrypted at rest, masked in logs             |
| Rotate secrets on exposure                 | Assume compromised if ever logged             |
| Separate secrets per environment           | Staging keys ≠ production keys                |
| Use OIDC for cloud providers               | No long-lived credentials needed              |

## Release Automation

### Semantic Versioning

```
MAJOR.MINOR.PATCH
  │      │     └── Bug fixes (backward compatible)
  │      └──────── New features (backward compatible)
  └─────────────── Breaking changes
```

### Tag-Based Release

```yaml
on:
  push:
    tags: ["v*"]
jobs:
  release:
    steps:
      - uses: actions/checkout@v4
      - run: pnpm build
      - run: pnpm publish # or deploy
      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

## Common Rationalizations

| Excuse                              | Rebuttal                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| "CI is slow, I'll test locally"     | Local tests miss environment-specific issues. Optimize CI instead of skipping it. |
| "We can add CI later"               | Every merged PR without CI is a potential regression. Set up day one.             |
| "The pipeline is too complex"       | Complexity means you're catching real issues. Simplify steps, not coverage.       |
| "Manual deploy is faster"           | Until someone deploys the wrong branch. Automation prevents human error.          |
| "Caching is premature optimization" | 5 minutes saved per PR × 20 PRs/week = 100 minutes/week. Cache from day one.      |

## CI Performance Optimization

| Technique              | Savings                   | Effort                 |
| ---------------------- | ------------------------- | ---------------------- |
| Dependency caching     | 30-60s per run            | Low — add cache action |
| Parallel jobs          | 50-70% of sequential time | Low — split into jobs  |
| Conditional runs       | Skip unchanged paths      | Medium — path filters  |
| Build artifact caching | 1-5min per run            | Medium — cache config  |
| Self-hosted runners    | Faster hardware           | High — infrastructure  |

## Red Flags — STOP

- CI pipeline takes >15 minutes for a PR check
- Secrets hardcoded in workflow files
- No caching configured despite slow builds
- Tests skipped in CI "to save time"
- Manual deployment steps in the release process
- No rollback mechanism for failed deployments

## Verification

- [ ] All verification steps run on every PR
- [ ] Pipeline fails fast (cheapest checks first)
- [ ] Dependencies are cached
- [ ] Secrets are never printed in logs
- [ ] Release process is tag-triggered and automated
- [ ] Rollback procedure is documented and tested

## See Also

- **verification-gates** — Detecting project type and running appropriate checks
- **git-workflow-and-versioning** — Branch strategy and commit conventions
- **security-and-hardening** — Secrets management and supply chain security
