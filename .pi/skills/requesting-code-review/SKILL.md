---
name: requesting-code-review
description: Use when completing meaningful implementation work and needing a high-signal review pass before merge or release - dispatches scoped review agents, synthesizes findings, and routes follow-up actions by severity.
version: 1.2.0
tags: [workflow, code-quality, research]
dependencies: []
references:
  - references/specialist-profiles.md
---

# Requesting Code Review

## Overview

Request review when work is **potentially shippable** and you need fresh scrutiny before moving on.

This skill is for **asking for review**, not blindly obeying reviewers. The review output is advisory until verified against the codebase.

**Core principle:** tighter review packet → better findings. Fewer files + clearer requirements beats dumping a vague diff at five agents.

## When to Use

- After completing a feature, bugfix, or meaningful task batch
- Before merging to main or creating a PR
- Before release or after a risky refactor
- When you need multiple review angles on the same implementation

## When NOT to Use

- During TDD RED phase or any intentionally failing state
- When you only need a single targeted technical answer
- When implementation is still obviously incomplete and review would be premature

## Golden Path

1. **Stabilize the work** — run the relevant verification first
2. **Build a tight review packet** — what changed, requirements, diff range, notable risks
3. **Choose review depth** — targeted, standard, or full multi-angle review
4. **Dispatch review agents in parallel**
5. **Deduplicate + synthesize findings**
6. **Fix or push back with evidence**
7. **Re-verify after changes**

## Review Packet

Before dispatching any reviewer, assemble a packet with:

- **What changed** — 2-6 bullet summary
- **Requirements / plan** — acceptance criteria or plan excerpt
- **Diff range** — `BASE_SHA..HEAD_SHA`
- **Risk hints** — auth, migrations, concurrency, data deletion, perf-sensitive path, etc.
- **Verification already run** — typecheck/lint/test/build status

Minimal packet template:

```markdown
What was implemented:

- [change 1]
- [change 2]

Requirements:

- [acceptance criterion 1]
- [acceptance criterion 2]

Diff:

- BASE_SHA: {BASE_SHA}
- HEAD_SHA: {HEAD_SHA}

Already verified:

- [command] — [result]

Risk areas:

- [auth | migrations | concurrency | performance | none]
```

## Review Depth Selection

Choose the smallest review depth that still covers the risk.

| Depth        | Use When                                    | Agents |
| ------------ | ------------------------------------------- | ------ |
| **targeted** | Small fix, one main risk, one area changed  | 1-2    |
| **standard** | Typical feature/fix ready for merge         | 3      |
| **full**     | Risky, cross-cutting, release-critical work | 5      |

### Routing Rules

- **targeted**: use 1-2 specific review prompts
- **standard**: use security/correctness, tests/types, and completeness
- **full**: use all 5 specialized review prompts + specialist profiles from [references/specialist-profiles.md](references/specialist-profiles.md)

For **standard** and **full** reviews, enhance dispatch prompts with specialist reviewer profiles (security, architecture, performance) and run an adversarial pass on findings. See [references/specialist-profiles.md](references/specialist-profiles.md) for the exact prompt additions and confidence thresholds.

Do **not** dispatch 5 reviewers by reflex for every tiny change. That produces noise, not rigor.

## Review Scope Self-Check

Before writing ANY review finding, the reviewer MUST ask:

> **"Am I questioning APPROACH or DOCUMENTATION/CORRECTNESS?"**

| Answer | Action |
| --- | --- |
| **APPROACH** — "I would have done it differently" | **Stay silent.** The approach was decided during planning. Review doesn't re-litigate design. |
| **DOCUMENTATION** — "A new developer couldn't execute this" | **Raise it.** Missing file paths, vague acceptance criteria, assumed context. |
| **CORRECTNESS** — "This will break at runtime" | **Raise it.** Bugs, security holes, type errors, logic flaws. |

### Red Flags for Scope Creep

- Suggesting alternative libraries or frameworks → **out of scope** (approach)
- "I would rename this to..." without a concrete bug → **out of scope** (style preference)
- "Consider adding feature X" that wasn't in requirements → **out of scope** (scope inflation)
- "This could be more performant" without evidence of a real problem → **out of scope** (premature optimization)

### What Reviewers SHOULD Flag

- Missing error handling that will crash in production → **correctness**
- Vague acceptance criteria that workers can't verify → **documentation**
- Hardcoded values with no explanation → **documentation**
- Missing file paths for tasks that require edits → **documentation**
- "Use the existing pattern" without specifying which pattern → **documentation**
- Security vulnerabilities (injection, auth bypass, secrets) → **correctness**

Include this self-check instruction in EVERY review dispatch prompt to prevent bikeshedding.

## Step 1: Get Git Context

### Setup Checklist

- [ ] Determine `BASE_SHA` and `HEAD_SHA`
- [ ] Summarize requirements or link plan
- [ ] Decide review depth

```bash
BASE_SHA=$(git rev-parse origin/main 2>/dev/null || git rev-parse HEAD~1)
HEAD_SHA=$(git rev-parse HEAD)
```

If work is still uncommitted, use the working tree review path and clearly say so in the review packet.

## Step 2: Dispatch Reviewers in Parallel

### A. Security + Correctness

```typescript
task({
  subagent_type: "review",
  description: "Security + correctness review",
  prompt: `Review this implementation for real bugs in changed code only.

Review packet:
{REVIEW_PACKET}

Run:
  git diff {BASE_SHA}..{HEAD_SHA}

Check for:
- Security vulnerabilities (injection, auth bypass, secrets exposure, missing validation)
- Logic errors, null/undefined access, incorrect guards
- Broken async/error handling
- Data integrity issues

Rules:
- Review only changed code
- Read full changed files for context before flagging issues
- Do not speculate; explain the concrete failure scenario

Return:
- CRITICAL / IMPORTANT / MINOR findings
- file:line references
- brief reasoning for each finding`,
});
```

### B. Performance + Architecture

```typescript
task({
  subagent_type: "review",
  description: "Performance + architecture review",
  prompt: `Review this implementation for performance and architecture issues.

Review packet:
{REVIEW_PACKET}

Run:
  git diff {BASE_SHA}..{HEAD_SHA}

Check for:
- Obviously expensive loops / N+1 / repeated work
- Over-engineering or abstraction without clear value
- Coupling that will make maintenance painful
- Missing use of existing abstractions/utilities

Rules:
- Flag only meaningful issues
- Skip style-only comments unless they cause structural problems

Return:
- CRITICAL / IMPORTANT / MINOR findings
- file:line references`,
});
```

### C. Type Safety + Test Quality

```typescript
task({
  subagent_type: "review",
  description: "Type safety + test review",
  prompt: `Review this implementation for type safety and test quality.

Review packet:
{REVIEW_PACKET}

Run:
  git diff {BASE_SHA}..{HEAD_SHA}

Check for:
- Unsafe assertions, type holes, lossy casts
- Missing coverage on important branches or edge cases
- Tests that only prove mocks, not behavior
- Tests that would still pass if implementation were wrong

Return:
- CRITICAL / IMPORTANT / MINOR findings
- file:line references`,
});
```

### D. Conventions + Existing Patterns

```typescript
task({
  subagent_type: "review",
  description: "Conventions + patterns review",
  prompt: `Review this implementation against existing codebase patterns.

Review packet:
{REVIEW_PACKET}

Run:
  git diff {BASE_SHA}..{HEAD_SHA}
  git log --oneline -10

Check for:
- Divergence from existing code organization or naming
- Reimplementation of existing utilities/helpers
- Documentation drift where changed code no longer matches docs
- New patterns that conflict with established ones

Return:
- CRITICAL / IMPORTANT / MINOR findings
- file:line references`,
});
```

### E. Simplicity + Completeness

```typescript
task({
  subagent_type: "review",
  description: "Simplicity + completeness review",
  prompt: `Review this implementation for completeness and unnecessary complexity.

Review packet:
{REVIEW_PACKET}

Run:
  git diff {BASE_SHA}..{HEAD_SHA}

Check for:
- Missing requirements or acceptance criteria
- Dead code, TODOs, unreachable branches
- Complexity that can be deleted without losing behavior
- Behavior changes that appear unintentional

Return:
- CRITICAL / IMPORTANT / MINOR findings
- file:line references`,
});
```

## Dispatch Matrix

| Depth        | Reviewers to Run             |
| ------------ | ---------------------------- |
| **targeted** | Choose the 1-2 most relevant |
| **standard** | A + C + E                    |
| **full**     | A + B + C + D + E            |

## Step 3: Synthesize Findings

### Synthesis Checklist

- [ ] Merge duplicate findings across reviewers
- [ ] Keep the strongest explanation when multiple reviewers report same issue
- [ ] Separate real blockers from optional improvements
- [ ] Mark disputed / uncertain findings explicitly

Output format:

```markdown
## Review Summary

**Review depth:** [targeted | standard | full]
**Agents run:** [N]
**Critical:** [N]
**Important:** [N]
**Minor:** [N]

### Critical Issues

- `path/to/file.ts:123` — [issue + why it breaks]

### Important Issues

- `path/to/file.ts:123` — [issue]

### Minor Issues

- `path/to/file.ts:123` — [optional improvement]

### Disputed / Needs Verification

- [finding that may be wrong, plus what evidence would confirm it]

### Assessment

- [ ] Ready to proceed
- [ ] Fix required first
```

## Step 4: Act on Findings

### Remediation Checklist

- [ ] Fix all Critical findings before proceeding
- [ ] Fix Important findings in the current branch unless consciously deferred
- [ ] Record deferred Minor findings somewhere durable
- [ ] Push back on wrong findings with code/tests, not opinion

| Severity      | Action                                        |
| ------------- | --------------------------------------------- |
| **Critical**  | Fix immediately before any further work       |
| **Important** | Fix now or explicitly defer with reason       |
| **Minor**     | Track for later if not worth immediate change |

If a finding looks wrong, verify it against the codebase before changing anything.

## Step 5: Re-verify

After fixing review findings, re-run the relevant verification commands.

At minimum, use the commands appropriate for the project toolchain:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build` (if release/build-sensitive)

Do not claim review is resolved until fresh verification passes.

## Placeholders Reference

| Placeholder       | What to fill                     |
| ----------------- | -------------------------------- |
| `{REVIEW_PACKET}` | Tight review packet with context |
| `{BASE_SHA}`      | Starting commit SHA              |
| `{HEAD_SHA}`      | Ending commit SHA                |

## Integration with Workflows

| Command | When review runs                     |
| ------- | ------------------------------------ |
| `/ship` | After work is complete and verified  |
| `/pr`   | Before pushing or opening PR         |
| `/lfg`  | Between execution and compound steps |

## Common Mistakes

- Running 5 reviewers on a tiny one-file fix with no real risk
- Sending vague prompts with no requirements or verification status
- Treating reviewer output as automatically correct
- Failing to deduplicate repeated findings
- Skipping re-verification after review fixes

## After Review: Compound

Run `/compound` after resolving review findings to capture:

- Patterns review caught that should be prevented earlier
- False positives that should not be repeated
- Newly discovered codebase conventions

That turns review from a gate into a feedback loop.

## Autofix Classification

Every review finding should include a **fix category** that routes remediation. This prevents the user from manually triaging every finding.

| Category       | Meaning                                          | Agent Action                              |
| -------------- | ------------------------------------------------ | ----------------------------------------- |
| `safe_auto`    | Zero-risk fix (formatting, unused imports, typos) | Fix immediately without asking            |
| `gated_auto`   | Likely correct fix, but verify first              | Fix and show diff before committing       |
| `manual`       | Requires human judgment or architectural decision | Report to user with context, don't touch  |
| `advisory`     | Informational only, no action required            | Include in report, no remediation needed  |

### Reviewer Output Format (Enhanced)

Reviewers should return findings in this structure:

```markdown
### [SEVERITY]: [Title]

- **File:** `path/to/file.ts:123`
- **Category:** safe_auto | gated_auto | manual | advisory
- **Issue:** [concrete description of the problem]
- **Fix:** [specific fix if category is safe_auto or gated_auto]
```

### Classification Rules

1. **safe_auto** — formatting, whitespace, unused imports, typo in comments, missing trailing newlines. Must not change behavior.
2. **gated_auto** — missing null checks, error handling gaps, type narrowing fixes. Changes behavior but fix is clear and low-risk.
3. **manual** — architectural concerns, API design questions, security decisions, breaking changes. Requires human context.
4. **advisory** — "consider doing X", performance suggestions without evidence, alternative patterns. No action needed.

### Post-Synthesis Routing

After synthesizing all findings:

1. **Apply all `safe_auto` fixes** immediately
2. **Show `gated_auto` diffs** to user for approval before applying
3. **Present `manual` findings** as a prioritized list for user decision
4. **Append `advisory` findings** at the end of the report for reference

This routing ensures trivial fixes don't block the review while keeping humans in the loop for judgment calls.
