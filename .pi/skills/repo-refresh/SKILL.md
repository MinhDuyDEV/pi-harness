---
name: repo-refresh
description: User-invoked via /skill:repo-refresh. Refreshes an explicitly named repository by removing stale documentation, plans, issues, tests, proof machinery, scripts, and generated debris.
disable-model-invocation: true
---

# Repository Refresh

Refresh the named repository around current production truth. This is an explicit,
repository-wide cleanup workflow—not routine housekeeping or permission to
redesign working production architecture.

## Mode

Never invoke this skill implicitly. Infer the mode from the request:

- `audit`: inspect and report; default for a bare invocation.
- `apply`: audit, perform authorized cleanup, and verify. Requests to refresh,
  clean, fix, remove, or consolidate authorize this mode.
- `verify`: validate an earlier refresh without expanding scope.

An age threshold identifies suspects, never automatic deletion targets. Measure
tracked files by their last meaningful Git change; use filesystem mtime only as a
warning signal. Without a threshold, use current consumers, ownership, and
repository evidence.

Read [references/refresh-standard.md](references/refresh-standard.md) before
acting.

## Boundaries

- Read applicable repository instructions and inspect the worktree first.
- Preserve unrelated or pre-existing changes.
- Do not create branches, commits, PRs, issues, or external messages unless asked.
- Do not change production behavior merely to simplify cleanup; report an
  uncovered defect separately unless its repair is authorized.
- Use Git as history. Do not create archives, backup trees, migration diaries, or
  compatibility copies inside the repository.
- “Aggressive” broadens the suspect search; it never lowers the evidence bar.
  Exclude ignored runtime state unless the user names it, and do not age-delete
  active work, reproducibility contracts, or anything with a live consumer.

## Workflow

### 1. Establish current contracts

Identify production entry points and owners; canonical product, architecture,
process, and operations docs; active work; test and gate owners; generated-file
producers; and official acceptance commands. Verify claims against current code
and consumers rather than trusting names, timestamps, or “authoritative” labels.

### 2. Build an evidence ledger

Inventory duplicate docs and indexes; active, terminal, orphaned, and superseded
plans/issues; tests and custom proof routes; scripts, fixtures, reports, generated
outputs, and build debris; dead links and commands; and fragmented surfaces that
hide one contract.

For each suspect record its owner, current consumer, unique current information,
replacement destination, and deletion consequence.

### 3. Classify

Use one disposition:

- `KEEP`: uniquely owned current truth or proportionate proof.
- `MERGE`: unique truth belongs in another canonical owner.
- `REWRITE`: the owner is valid but duplication or history obscures it.
- `DEMOTE`: useful only as a non-gating diagnostic or closeout record.
- `DELETE`: stale duplication, generated debris, dead proof, or Git-owned history.
- `BLOCKED`: removal needs a product, compatibility, legal, or operational decision.

Age, size, ugliness, and low coverage are signals—not dispositions. If no suspect
qualifies after classification, report that result and stop rather than expanding
scope to manufacture deletions.

### 4. Apply a coherent cut

In `apply` mode, merge unique truth first, update live references, then delete
superseded sources in the same change. Treat plan artifacts through the
repository's active/completed lifecycle—not by age alone. Keep active plans and
compact durable closeouts; remove execution diaries and review packets. Remove or demote proof
without a current risk, production consumer, independent oracle, or deletion
sensitivity. Remove dead scripts, unowned fixtures, stale reports, and reproducible
outputs unless distribution requires them. Prefer one canonical owner and no empty
taxonomy.

### 5. Verify proportionately

Check Markdown links and stale references; tracker or plan schemas; generated
source parity; focused tests for changed tooling; formatting/whitespace; and the
smallest official acceptance command whose contract changed. Do not invent a new
proof framework merely to prove cleanup.

## Completion

Report the before/after structure; merged, rewritten, deleted, and deliberately
retained surfaces; proof machinery removed or demoted; commands actually run;
unavailable checks; blockers; and remaining current debt.

Do not claim completion while references are broken, contracts have competing
owners, completed plans remain active, or a mandatory proof route lacks a named
current risk and consumer.
