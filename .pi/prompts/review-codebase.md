---
description: Review code for quality, security, and compliance
argument-hint: "[path|work-id|pr-number|'all'] [--quick|--thorough]"
agentType: reviewer
---

# Review: $ARGUMENTS

Review changed code or a target path for correctness, security, maintainability, and goal completion.

## Load Skills

```typescript
skill({ name: "code-review-and-quality" });
skill({ name: "verification-before-completion" });
```

## Determine Input Type

| Input | Detection | Action |
| --- | --- | --- |
| No arguments | default | Review uncommitted changes |
| Work ID | `.pi/artifacts/$ARGUMENTS/` exists | Review current implementation against that spec |
| File/directory | path exists | Review that scope |
| Commit hash | SHA pattern | Review `git show <sha>` |
| PR URL/number | GitHub URL or number marker | Use `gh pr diff` |
| `all` | keyword | Review branch diff |

## Before You Review

- Only flag issues you can verify.
- Review changed code, not unrelated pre-existing code.
- Read full files, not just diff hunks.
- Use project conventions rather than personal style.
- If uncertain, inspect code paths before raising a finding.

## Phase 1: Gather Context

```bash
git status --short
git diff --cached
git diff
```

For each changed file, read the full file or relevant symbol sections.

If a work ID is provided, read `.pi/artifacts/$ARGUMENTS/SPEC.md` and any `PLAN.md` / `VERIFICATION.md` files.

## Phase 2: Scope

| Input | Scope | How to Get Code |
| --- | --- | --- |
| Path | That path only | `read`, `srcwalk_read`, `grep` |
| Work ID | Implementation vs spec | `.pi/artifacts/<id>/SPEC.md` + git diff |
| PR | PR changes | `gh pr diff` |
| `all` or empty | Recent/local changes | `git diff main...HEAD` or current diff |

## Phase 3: Automated Checks

Follow `verification-before-completion` for relevant gates.

Also scan for:

- Debug statements.
- Loose typing or unjustified ignores.
- `TODO`, `FIXME`, `HACK` markers in changed code.
- Hardcoded secrets or credentials.
- New dependencies without clear need.

## Phase 4: Manual Review

| Category | Focus |
| --- | --- |
| Correctness | Behavior matches spec and edge cases |
| Security | Auth checks, input validation, no secret exposure |
| Performance | Unbounded work, N+1 queries, hot-path regressions |
| Maintainability | Simplicity, naming, duplication, module boundaries |
| Error Handling | Useful context, safe user-facing errors |
| Testing | Changed behavior has meaningful tests |
| Type Safety | No unjustified `any`, null hazards, unsafe casts |

Depth levels:

- `--quick`: critical issues only.
- Default: full automated + manual review.
- `--thorough`: deeper call graph and blast-radius checks.

## Phase 5: Report

Group findings by severity:

- **Critical** — must fix before merge.
- **Important** — should fix or explicitly accept.
- **Minor** — optional cleanup.

Each finding must include file/line, issue, impact, and recommended fix.

Output:

1. Files reviewed.
2. Findings by severity.
3. Verification commands run.
4. Verdict: Ready / With fixes / Blocked.
5. Reasoning in 1-2 sentences.

Record significant findings with `observation()` when useful.

## Related Commands

| Need | Command |
| --- | --- |
| Ship after review | `/ship <id>` |
| Verify completeness | `/verify <id>` |
