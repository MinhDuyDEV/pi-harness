# Requesting code review

Give the reviewer a bounded, reproducible review target:

- the intended behavior and acceptance criteria;
- commit range or explicit changed-file list;
- risk surface and the review lenses needed (correctness, security,
  compatibility, performance, operability);
- exact verification commands and results;
- fixtures/reproduction for important edge cases;
- behavior deliberately left unchanged and known residual risk.

Keep the diff atomic. Identify unrelated dirty-worktree changes and exclude
them. Ask a concrete question rather than “LGTM”; the reviewer should not need
to reverse-engineer the contract or trust the author's summary.

Re-request review after changing a public contract, security boundary,
verification strategy, or large part of the reviewed diff.

