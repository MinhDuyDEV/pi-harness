# Receiving code review

Classify each comment as blocker, correctness/security risk, maintainability,
optional preference, question, or disagreement. Reproduce the concern before
dismissing it.

For an accepted finding, add a failing regression test when practical, make the
smallest fix, and rerun focused plus regression checks. For a disagreement,
reply with concrete code/spec evidence and the trade-off; do not performatively
agree or silently ignore it. Record an intentionally deferred finding with its
owner, reason, risk, and revisit condition.

A thread is resolved only when the fix or disposition, verification evidence,
and residual risk are visible. Reopen/re-request review when the response
changes the contract or invalidates the reviewer's original evidence.

