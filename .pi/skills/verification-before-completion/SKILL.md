---
name: verification-before-completion
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
version: 1.0.0
tags: [workflow, code-quality]
dependencies: []
---

# Verification Before Completion

## When to Use

- Before claiming tests/lint/build pass or a bug is fixed
- Before committing, opening PRs, or stating completion in a status update

## When NOT to Use

- While still actively coding without a completion claim
- When you cannot run verification commands yet (e.g., missing dependencies) — resolve first

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

**Violating the letter of this rule is violating the spirit of this rule.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this message, you cannot claim it passes.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying

```

## Verification Checklist

- [ ] Identify the exact command that proves the claim
- [ ] Run the full command (fresh)
- [ ] Read the full output and exit code
- [ ] Confirm the output matches the claim
- [ ] Only then state the completion claim with evidence

## Common Failures

| Claim                 | Requires                        | Not Sufficient                 |
| --------------------- | ------------------------------- | ------------------------------ |
| Tests pass            | Test command output: 0 failures | Previous run, "should pass"    |
| Linter clean          | Linter output: 0 errors         | Partial check, extrapolation   |
| Build succeeds        | Build command: exit 0           | Linter passing, logs look good |
| Bug fixed             | Test original symptom: passes   | Code changed, assumed fixed    |
| Regression test works | Red-green cycle verified        | Test passes once               |
| Agent completed       | VCS diff shows changes          | Agent reports "success"        |
| Requirements met      | Line-by-line checklist          | Tests passing                  |

## Red Flags - STOP

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!", etc.)
- About to commit/push/PR without verification
- Trusting agent success reports
- Relying on partial verification
- Thinking "just this once"
- Tired and wanting work over
- **ANY wording implying success without having run verification**

## Rationalization Prevention

| Excuse                                  | Reality                |
| --------------------------------------- | ---------------------- |
| "Should work now"                       | RUN the verification   |
| "I'm confident"                         | Confidence ≠ evidence  |
| "Just this once"                        | No exceptions          |
| "Linter passed"                         | Linter ≠ compiler      |
| "Agent said success"                    | Verify independently   |
| "I'm tired"                             | Exhaustion ≠ excuse    |
| "Partial check is enough"               | Partial proves nothing |
| "Different words so rule doesn't apply" | Spirit over letter     |

## Diagnostic Failure Phrases

These phrases are **automatic re-verification triggers**. If you catch yourself writing any of these (or semantic equivalents), STOP and run the actual verification command before continuing.

### Completion Claims Without Evidence

- "This should fix it"
- "That should resolve the issue"
- "The problem should be gone now"
- "This will work"
- "It's fixed"
- "Everything looks good"
- "We're all set"

### Confidence Substitution

- "I'm fairly certain this is correct"
- "Based on my understanding, this works"
- "This is straightforward enough"
- "The logic is sound"
- "This follows the pattern so it should be fine"

### Deflection / Minimization

- "It's just a minor change"
- "Nothing else should be affected"
- "The rest of the code is unchanged"
- "This is a safe change"
- "No side effects expected"

### Post-Hoc Rationalization

- "The error was probably just [X]"
- "That failure was likely a fluke"
- "It probably works in production"
- "The test environment might be the issue"

### False Completion

- "All done!" / "Done!" / "Complete!"
- "That takes care of everything"
- "Ready for review" (without verification output)
- "Committing now" (without verification output)

**Rule:** If any of these phrases appear in your draft response, delete them and replace with actual verification command output. The phrase IS the signal that you're about to lie.

## Key Patterns

**Tests:**

```
✅ [Run test command] [See: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**Regression tests (TDD Red-Green):**

```
✅ Write → Run (pass) → Revert fix → Run (MUST FAIL) → Restore → Run (pass)
❌ "I've written a regression test" (without red-green verification)
```

**Build:**

```
✅ [Run build] [See: exit 0] "Build passes"
❌ "Linter passed" (linter doesn't check compilation)
```

**Requirements:**

```
✅ Re-read plan → Create checklist → Verify each → Report gaps or completion
❌ "Tests pass, phase complete"
```

**Agent delegation:**

```
✅ Agent reports success → Check VCS diff → Verify changes → Report actual state
❌ Trust agent report
```

## Smart Verification

The Iron Law demands evidence, but evidence should be gathered efficiently.

### Incremental by Default

Unless shipping or `--full` is passed, verify only what changed:

- **Lint**: `oxlint <changed-files>` instead of linting the entire codebase
- **Test**: `vitest run --changed` instead of running all tests
- **Typecheck**: always full (type errors propagate across files)

See the [Verification Protocol](./references/VERIFICATION_PROTOCOL.md) for exact commands.

### Parallel Execution

Run independent gates simultaneously to reduce wall-clock time:

```
Parallel: typecheck + lint → both must pass
Sequential: test → build (ship only)
```

Total time = max(typecheck, lint) + test, not typecheck + lint + test.

### Verification Cache

If you just verified and nothing changed, don't re-verify:

1. After gates pass, record a stamp in `.beads/verify.log`
2. Before running gates, compare current state to last stamp
3. If match → report cached PASS, skip redundant work
4. Cache is always bypassed for `--full` and ship/release

This matters when other commands need verification (e.g., closing beads, `/ship`). If you verified 30 seconds ago and made no changes, the cache lets you skip.

## Enforcement Gates

Prompt-level rules get ignored under pressure. These gates are **hard blocks** — they must be checked at the tool/action level, not just remembered.

### Gate 1: Completion Claims Require verify.log

Before ANY completion claim (bead close, PR creation, `/ship`, task completion):

1. Check `.beads/verify.log` exists and contains a recent `PASS` stamp
2. If verify.log is missing or stale (older than last file change) → **BLOCK** — run verification first
3. If verify.log shows `FAIL` → **BLOCK** — do not proceed

```
✅ verify.log exists, PASS within last edit window → proceed
❌ verify.log missing → STOP: "Run verification first"
❌ verify.log shows FAIL → STOP: "Verification failed, fix before claiming complete"
❌ verify.log stale (files changed since last PASS) → STOP: "Re-run verification"
```

### Gate 2: Agent Delegation Requires Post-Verification

After ANY `task()` subagent returns with "success", follow the **Worker Distrust Protocol** from AGENTS.md — read changed files, run verification, check acceptance criteria. Do not trust agent self-reports.

### Enforcement Principle

> **Prompt rules fail under pressure. Gates fail safe.**
>
> When a constraint matters enough to be an iron law, enforce it at the action level:
> check a file, verify a condition, reject if unmet. Don't rely on the agent
> "remembering" to follow the rule.

## Phantom Completion Detection

Tasks can "pass" verification while containing stub implementations. This gate catches completions that are technically correct but substantively empty.

### When to Run

- After all PRD tasks are marked complete (during `/ship` Phase 4-5)
- Before closing any bead
- When `--full` verification is requested

### Stub Patterns to Detect

Scan all files modified in the current task/bead for these phantom indicators:

```bash
# Run against modified code files only (exclude .md, .json, .yml to avoid false positives)
git diff --name-only origin/main | grep -E '\.(ts|tsx|js|jsx|py|rs|go|swift|kt|java)$' | xargs grep -nE \
  'return null|return undefined|return \{\}|return \[\]|onClick=\{?\(\) => \{\}\}?|TODO|FIXME|placeholder|stub|not.?implemented|throw new Error\(.Not implemented' \
  2>/dev/null
```

| Pattern                                                  | What It Indicates         | Severity |
| -------------------------------------------------------- | ------------------------- | -------- |
| `return null` / `return undefined`                       | Empty implementation      | HIGH     |
| `return {}` / `return []`                                | Hollow data               | HIGH     |
| `onClick={() => {}}`                                     | No-op handler             | HIGH     |
| `<div>Component</div>` / `<div>{/* TODO */}</div>`       | Placeholder UI            | HIGH     |
| `TODO` / `FIXME` / `HACK`                                | Acknowledged incomplete   | MEDIUM   |
| `placeholder` / `stub` / `not implemented`               | Self-documenting stubs    | HIGH     |
| `throw new Error("Not implemented")`                     | Explicit stub             | HIGH     |
| `fetch('/api/...')` without `await` or error handling    | Disconnected call         | MEDIUM   |
| `Response.json({ok: true})` or static hardcoded response | Fake API response         | HIGH     |
| `console.log` as only function body                      | Debug-only implementation | MEDIUM   |

### Three-Level Artifact Verification

For each file listed in PRD `Affected Files`:

| Level              | Check                  | How                                                                                          |
| ------------------ | ---------------------- | -------------------------------------------------------------------------------------------- |
| **1: Exists**      | File is present        | `ls path/to/file.ts`                                                                         |
| **2: Substantive** | Not a stub/placeholder | `grep -v "TODO\|FIXME\|return null\|placeholder" path/to/file.ts` — verify real logic exists |
| **3: Wired**       | Connected and used     | `grep -r "import.*ExportName" src/` — verify other files import/use it                       |

### Key Link Verification

Check that components are actually connected (not just existing side-by-side):

| Connection Type | Check Command                                                  |
| --------------- | -------------------------------------------------------------- |
| Component → API | `grep -E "fetch.*api/\|axios\|useSWR\|useQuery" Component.tsx` |
| API → Database  | `grep -E "prisma\.\|db\.\|sql\|query" route.ts`                |
| Form → Handler  | `grep "onSubmit\|handleSubmit" Component.tsx`                  |
| State → Render  | `grep "{stateVar}" Component.tsx`                              |
| Route → Page    | Check router config references the page component              |

### Phantom Score

After running all checks, report a phantom score:

```
Phantom Completion Check:
- Files scanned: [N]
- Stubs found: [N] (HIGH: [n], MEDIUM: [n])
- Artifact levels: [N] exist, [M] substantive, [K] wired
- Key links verified: [N]/[M]
- Score: [CLEAN | SUSPECT | PHANTOM]
```

| Score       | Criteria                                       | Action                            |
| ----------- | ---------------------------------------------- | --------------------------------- |
| **CLEAN**   | 0 HIGH stubs, all artifacts Level 3            | Proceed                           |
| **SUSPECT** | 1-2 MEDIUM stubs OR 1 artifact not Level 3     | Report, ask user                  |
| **PHANTOM** | Any HIGH stubs OR >2 artifacts not substantive | **BLOCK** — fix before completion |

## Why This Matters

From 24 failure memories:

- your human partner said "I don't believe you" - trust broken
- Undefined functions shipped - would crash
- Missing requirements shipped - incomplete features
- Time wasted on false completion → redirect → rework
- Violates: "Honesty is a core value. If you lie, you'll be replaced."

## When To Apply

**ALWAYS before:**

- ANY variation of success/completion claims
- ANY expression of satisfaction
- ANY positive statement about work state
- Committing, PR creation, task completion
- Moving to next task
- Delegating to agents

**Rule applies to:**

- Exact phrases
- Paraphrases and synonyms
- Implications of success
- ANY communication suggesting completion/correctness

## The Bottom Line

**No shortcuts for verification.**

Run the command. Read the output. THEN claim the result.

This is non-negotiable.
