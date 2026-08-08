# ADR 0001: Minimal Governed Coordination

**Status:** Accepted

**Date:** 2026-08-08

## Context

Pi-harness already has one parent, durable task state, claims and leases, worktree isolation, proof, independent review, replay, and human steering through `@minhduydev/pi-subagents`. A Supervisor–Lead–Peer graph or a second control plane would duplicate lifecycle truth and create split-brain, direct-write races, recursive coordination, and additional token cost.

The remaining problem is narrower: make delegation boundaries explicit, measurable, and consistent without claiming stronger enforcement than the host provides.

## Decision

### One control plane

`pi-subagents` is the only lifecycle control plane. It owns task admission, runs, claims, leases, decisions, evidence, review, recovery, and replay. Pi-harness owns portable policy and role profiles. `pi-core` owns only shared schemas that have real cross-package consumers. `pi-todo` displays work state; `pi-learning` supplies trust-filtered context; srcwalk supplies bounded code evidence. None of them becomes an orchestration authority.

The root agent owns orchestration and readiness assessment. A human or host trust boundary—not a model-authored field—authorizes irreversible actions such as merge, protected push, publish, deploy, secret use, policy mutation, destructive commands, force-push, or history rewrite. In an interactive Pi session, use `ask_user` for the approval decision; when that UI is unavailable, stop and request an explicit human decision rather than treating model text as approval.

### Threat model

Children are assumed fallible by default: they may misunderstand scope, use stale context, or execute a wrong but plausible action. Claims, isolation, proof, and independent review mitigate those failures.

A malicious or compromised child is a stronger threat. Prompt rules, tool-name filters, path extraction, and shell heuristics are not a sandbox. Deployments that must resist malicious code require a host/OS boundary such as a restricted account, container, network policy, and secret isolation.

### Agency Justification

Use a subagent only when at least one named constraint justifies the coordination cost: independently parallel work, context isolation, independent verification, or tool/policy isolation. Keep small single-scope work in the parent. Record the constraint in the delegation brief. If telemetry does not show improved quality, latency, or context pressure, stop adding agents or coordinator roles.

### Enforcement semantics

Pre-write enforcement applies only when the runtime can identify the mutating tool and target path before execution. Claims and fenced leases must reject a conflicting recognized write.

Mutations through shell commands, custom tools, or opaque processes may not be fully pre-fenced. Worktree isolation, post-run diff/claim audit, proof, and review provide post-run detection and containment. Documentation must not present these checks as a security sandbox.

An intervention is a durable, claim-respecting task created before action. There is no direct supervisor write. Producer, verifier, and irreversible-action authority remain separate.

### Telemetry and stop conditions

Measure delegation rate, child reuse, claim conflicts, blocked reasons, parent queue time, context pressure, token and wall-clock cost, proof failures, review findings, retries, and manual recovery. Do not add concern coordinators, automatic replanning, batch-proof authority, or model-seat post-verification unless a measured failure requires them.

Stop or roll back a change when it adds coordination cost without a sustained improvement, causes incompatible consumer behavior, weakens the human boundary, creates a second lifecycle truth, or cannot be verified against a real backend where mocks are insufficient.

### Optional peer communication

`sting8k/pi-peer` or a compatible fork may be evaluated only as an opt-in root-to-read-only-advisor channel. Pi-peer is optional and carries untrusted advice, never authority, lifecycle state, proof, review, or audit truth. Writer children do not receive peer tools. Any relied-upon conclusion must be re-established in canonical task context or evidence. Paseo and default pi-peer installation are rejected.

## Package ownership

| Package | Ownership |
| --- | --- |
| `pi-harness` | Policy, ADRs, role semantics, Agency Justification, human boundary |
| `pi-core` | Canonical cross-package schemas/events only |
| `pi-subagents` | Runtime enforcement and lifecycle truth |
| `pi-learning` | Trust-filtered context; no decision authority |
| `pi-todo` | Human-readable blockers, decisions, and reconciliation state |
| `pi-srcwalk` | Discovery and review evidence; no authority |
| `pi-search` | External discovery/search; no authority |
| `supi-ask-user` | Interactive human decision form; no autonomous authority |
| `pi-peer` | Optional advisory transport only |

Before adding shared authority or escalation schemas, remove duplicate proof, review, or learning payload definitions so `pi-core` remains canonical. While `pi-core` remains on its `0.3.x` line, prefer additive compatible contracts over a coordinated schema-epoch bump.

## Consequences

The architecture remains a bounded parent-to-child tree rather than a governance graph. Concern checks are ordinary read-only review tasks. The existing advisory `peer` role keeps its meaning. Rich authority matrices, autonomous coordinators, runtime model-seat verification, durable batch proof, and learning-at-decomposition remain conditional slices rather than assumed roadmap commitments.
