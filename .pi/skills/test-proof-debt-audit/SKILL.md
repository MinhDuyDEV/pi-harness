---
name: test-proof-debt-audit
description: >-
  User-invoked via /skill:test-proof-debt-audit. Audits one named behavioral
  claim and the test, validator, benchmark, or gate cited as proof. Do not use
  for ordinary implementation, failing tests, weak coverage, or the presence of
  mocks.
disable-model-invocation: true
---

# Test Proof Debt Audit

Audit only the claim and proof route named by the user. Do not turn ordinary
implementation, a failing test, weak coverage, or the presence of mocks into a
repository-wide proof audit.

## Scope

One claim, one proof route: the specific test, validator, benchmark, or gate the
user cites, plus the production code path that supposedly makes the claim true.
Report what the proof actually observes: behavior, machine-readable contract,
performance, or proxy text/metadata.

## Audit steps

1. **Name the claim** and the production behavior that makes it true.
2. **Identify the cited proof** and what it observes (behavior, contract,
   performance, or proxy text/metadata).
3. **Apply deletion sensitivity**: would the proof still pass if the claimed
   behavior disappeared?
4. **Check independent truth**: do expected values come from current contract,
   spec, or oracle rather than from the code under test or repository history?
5. **Choose a disposition**:

| Disposition | Meaning |
| --- | --- |
| `keep` | Proof observes behavior with independent expected values. |
| `replace` | Proof is derivable from the current contract; swap in a current-boundary case. |
| `demote` | Evidence only for lint or closeout, not runtime behavior. |
| `closeout-only` | Record for a completed change; never a current gate. |
| `delete` | History-only expected values or dead proof with no current use. |
| `escalate` | Proof debt hides a real behavioral gap; name the owning decision. |

## Gates

- Treat **history-only expected values** as proof debt. A current test must not
  name or pin a retired width, tag, field, version, byte sequence, or identifier
  merely to prove its rejection. Ask whether the test could be derived from the
  current contract without repository history; if not, `replace` it with
  current-boundary cases, `demote` it to closeout-only evidence, or `delete` it —
  unless the historical value is itself a current public machine/security
  contract.
- **Proxy evidence** can support lint or closeout but cannot prove runtime
  behavior. Mocks and replicas prove only their own boundary unless the claim is
  explicitly about that boundary.
- **Weak proof does not authorize an architecture redesign.** Report the gap and
  the smallest proof that would cover it; change production code only when asked.
- **Assessment only**: report and stop. Modify proof or production code only when
  the user requested the change.

## Report

State location, claimed behavior, actual observation, disconfirming scenario, and
smallest replacement. To pressure-test a disposition: delete the claimed behavior
and run the proof; remove the expected value and check it still passes; derive the
expected value from the current contract instead of history; substitute a
different input and see whether the proof distinguishes it. A disposition that
does not survive these probes is not final.
