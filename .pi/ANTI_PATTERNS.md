# Anti-Patterns

Shared vocabulary — reference these by name in reviews, briefs, and plans ("does this plan
have a balloon?", "that brief pre-solves the answer"). Naming a failure mode is cheaper than
re-explaining it every session. Each entry: name, what it is, signals, response.

## pre-solve

The delegator embeds a hypothesis or answer in the brief ("root cause is the cache — confirm"),
turning a capable agent into a confirmation tool and importing the delegator's bias.

- **Signals**: closed questions ("is this correct?", "A or B?"); briefs containing the fix or the exact verification steps; results that mirror the parent's guess.
- **Response**: brief with outcome, real constraints, and required evidence — no candidate answer. Ask for ranked causes with evidence, fact separated from inference. Then challenge the result.

## balloon

A strong model compensates for a broken foundation — extra abstractions, locks, caches,
retries, heuristics — instead of questioning the foundation. Each workaround looks reasonable
in isolation.

- **Signals**: fixes that add coordination machinery rather than remove a cause; test-green achieved by special-casing; the same subsystem needing "one more" patch repeatedly.
- **Response**: ask "is the foundation right? is this constraint real or legacy?" before accepting the workaround. Pause feature work and fix the base when the answer is no.

## brake

Accelerating — more features, more agents, more deploys — before the system has brakes:
validation, ownership, rollback, evidence, observability, failure handling.

- **Signals**: no rollback path; no way to tell a failed change from a slow one; adding throughput to a pipeline that cannot yet detect its own errors.
- **Response**: build the stopping/observing capability first; treat missing brakes as a blocker for speed-ups, not a follow-up.

## weak-scout-conclusion

A cheap or scouting model draws conclusions about complex root causes, architecture, security,
or concurrency instead of stopping at navigation artifacts. A wrong conclusion costs more than
having no scout.

- **Signals**: survey output that asserts "the root cause is X" or picks a design; confidence without evidence grading.
- **Response**: scouts deliver maps — file lists, call graphs, high-leverage areas, hypotheses explicitly marked unverified. Conclusions belong to a stronger pass.

## polling-waste

Repeatedly asking "is it done yet?" — burning context and tokens, cooling caches, and adding
noise without changing state.

- **Signals**: status-check turns with no new information; parent loops re-reading task state.
- **Response**: rely on event-driven completion signals; check only when signaled; back off if forced to poll.

## frozen-wait

The workflow freezes because two sides use mismatched state semantics — e.g. the parent waits
for `idle` while the child already reported `done`.

- **Signals**: a finished task nobody collects; "still waiting" on work whose deliverable exists.
- **Response**: use one state vocabulary (working / blocked / done / idle / stopped / error); treat `done` as "collect results now", never as "keep waiting".

## dual-ownership

Two writers own the same files or scope at the same time, producing conflicts, clobbered edits,
and unreviewable diffs.

- **Signals**: overlapping edit scopes in parallel tasks; merge surprises; "who changed this?" moments.
- **Response**: one owner per scope at a time; peers and reviewers read-only; ownership handover is explicit and the old owner stops first.

## evidence-collision

Concurrent heavy runs (tests, benchmarks, ports, shared DBs) contaminate each other, yielding
false red or false green and overwritten artifacts.

- **Signals**: results that flip without code changes; port/DB conflicts; artifacts from run A cited for run B.
- **Response**: serialize or lock heavy evidence resources; record the environment context with every piece of evidence so it can be judged later.

## priority-by-label

Executing tasks strictly by priority label. A P2 foundation task may resolve the P0 more
completely than attacking the P0 head-on.

- **Signals**: queue sorted only by P-number; urgent fixes repeatedly re-opened; foundation work perpetually deferred.
- **Response**: order by dependency, leverage, rework cost, and absorption (a larger plan may close smaller issues — verify with evidence). Reconcile the queue every few tasks.

## over-compression

Summarizing or compacting context until claims can no longer be verified — no paths, no
evidence references, no way back to the source.

- **Signals**: handoffs with conclusions but no artifact pointers; "as established earlier" with nothing on disk.
- **Response**: compress detail, never verifiability. Every handoff keeps paths to original artifacts and evidence so claims can be re-checked.

## fake-green

A passing signal treated as proof when the test does not cover the claim, is flaky, or the
environment is polluted.

- **Signals**: green tests for behavior that was never exercised; passes that disappear on a clean checkout; "tests pass" with no command shown.
- **Response**: audit what the evidence actually proves; distinguish code failure from environment failure; require command + observed result, not assertions.

## feature-over-foundation

Shipping features on a foundation known to be wrong. Every new layer raises the cost of the
eventual fix and invites more balloons.

- **Signals**: "we'll fix the base later" while building on it; new work inheriting a flaw everyone acknowledges.
- **Response**: stop and fix the foundation first, or explicitly record the decision and its expiry condition. Building on known-wrong ground is a decision, not a default.
