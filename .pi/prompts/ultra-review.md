---
description: Run a ten-reviewer maximum-recall review and preserve every candidate in a durable local report
argument-hint: "<review-name> <scope> [--round N]"
---

# Ultra Review: $ARGUMENTS

Resolve the repository root as the nearest ancestor containing both `package.json`
and `.pi`; stop if none exists. Parse the required review name and scope plus an
optional round number.

Load `/skill:ultra-review`. That skill owns reviewer packets, review axes, recovery,
report structure, synthesis, and proof boundaries; do not duplicate or weaken its
policy here.

Before launch, freeze the commit, worktree-status digest, scope, change intent,
applicable repository contracts, prior-round warnings, and report path under
`<repo-root>/.pi/artifacts/review/`.

Launch exactly ten read-only tasks in one parallel orchestration group. Use eight
`ultra-reviewer` tasks for logical slots 01, 03, 04, 05, 06, 07, 08, and 09. Use
two `reviewer` tasks for slot 02 (security and trust boundaries) and slot 10
(adversarial open sweep). Keep the logical IDs and differentiated axes defined by
the skill.

Give each task a governed prompt with Outcome, Frontier, locked decisions with
rationale and unlock conditions, Acceptance evidence, Non-goals, and an explicit
read-only policy. Do not override the canonical model seats pinned by the agent
profiles. Record task and batch identities in the report method.

Do not poll background tasks. Process durable completion notifications; recover
only missing logical slots according to the skill. The parent is the sole report
writer.

After all slots are complete or explicitly unavailable, preserve each raw result
before synthesis, build the candidate ledger, clusters, and verification queue,
and report:

1. durable report path;
2. reviewed snapshot and whether it still matches;
3. completed and unavailable slot counts;
4. raw candidate and consolidated finding counts;
5. strongest reason not to merge yet;
6. `/skill:ultra-review-receive <report-path>` as the next action.

This prompt collects candidates only. Do not verify findings, edit source, or claim
merge readiness.
