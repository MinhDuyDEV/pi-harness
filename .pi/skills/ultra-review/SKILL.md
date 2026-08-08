---
name: ultra-review
description: User-invoked via /skill:ultra-review or /ultra-review. Runs a maximum-recall static review with ten independent read-only reviewer slots and preserves every candidate in a durable local report.
disable-model-invocation: true
---

# Ultra Review

Run a maximum-recall bug hunt. Candidate findings may be speculative, duplicated,
low-confidence, or ultimately false; collection must not silently filter them.
Verification and remediation belong to `/skill:ultra-review-receive`.

Use the `/ultra-review` prompt for orchestration. This skill owns the review and
artifact contracts, not task-launch syntax.

## Inputs

Require a review name and scope. Record the change intent, applicable repository
contracts, prior-round warnings, current commit, worktree status digest, and the
reviewed snapshot. Block if the repository or scope cannot be identified.

## Ten independent review slots

Launch exactly ten logical, read-only slots in one parallel group. Give every slot
the same scope, caller directives, contracts, and prior-round warnings, but assign
one primary axis so their search paths are meaningfully independent:

1. correctness, state transitions, and regressions;
2. security, authorization, trust boundaries, and adversarial input;
3. API, schema, protocol, storage, and compatibility contracts;
4. concurrency, ordering, cancellation, cleanup, and resource lifetime;
5. errors, retries, fallbacks, partial failure, and invariant handling;
6. performance, allocation, rescans, N+1 work, blocking, and contention;
7. tests, proof gaps, fake-green evidence, fixtures, and validators;
8. ownership, lifecycle, module boundaries, and broken-foundation compensation;
9. packaging, generated artifacts, dependencies, CI, docs, and examples;
10. adversarial open sweep across excluded paths and alternate call traces.

Axes focus effort; they do not prohibit reporting an in-scope concern discovered
elsewhere. Reviewers must not coordinate findings or mutate the repository.

Each packet requires exact `file:line` evidence when available, violated contract,
plausible failure mode, severity, confidence, durable fix hypothesis, and a
read-only disconfirming check. Reviewers may return incomplete hypotheses rather
than suppressing them. Candidate count and reviewer agreement are never proof.

## Recovery

Freeze the ten logical IDs, axes, snapshot, batch identity, and report path. On a
restart or failed task, inspect durable task state first. Resume or replace only
missing slots under their original IDs and axes; never create an eleventh slot or
repeat completed work. Mark unavailable slots explicitly rather than inventing
results.

## Artifact contract

Write only under:

```text
.pi/artifacts/review/ultra-review-<review-name>-<snapshot>/
```

The parent/coordinator is the sole artifact writer. Create:

- `METHOD.md`: scope, intent, snapshot, worktree digest, contracts, axes, task IDs,
  prompts, timestamps, and unavailable slots;
- `RAW-slot-01.md` through `RAW-slot-10.md`: immutable result envelopes, written
  once and preserved exactly;
- `ALL-CANDIDATES.md`: concatenated candidates with durable candidate IDs;
- `SYNTHESIS.md`: root-cause clusters that map back to every raw candidate ID;
- `VERIFY.md`: one verification-queue row per candidate or cluster.

Never delete raw candidates during clustering. Duplicates may share a canonical
cluster while retaining every source ID. If no candidates are reported, state that
explicitly. Do not mistake the artifact for a merge verdict.

## Synthesis contract

Each consolidated finding uses `F001`, `F002`, … and includes severity,
confidence, all source candidate IDs, source pointers, observed evidence, expected
contract, failure mode, fix hypothesis, and disconfirming check. Preserve prior
round findings and dispositions as context; prior rejection does not suppress a
new candidate.

End with the strongest reason not to merge yet and the exact receive instruction:

```text
Use /skill:ultra-review-receive with <report-path> to verify and disposition every finding.
```

Report the artifact path, completed/unavailable slot count, candidate count, and
whether the reviewed snapshot still matches the workspace.
