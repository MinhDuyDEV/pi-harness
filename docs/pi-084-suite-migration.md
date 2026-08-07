# Pi 0.84 suite migration decision

Status: accepted for the `pi-harness 2.6` package suite (2026-08-07).

## Context

Pi 0.84 provides a native fullscreen TUI and native DeepSeek, Xiaomi/MiMo, and xAI provider/authentication support. Keeping harness implementations of the same capabilities creates two owners for provider registration, credentials, model metadata, rendering state, key handling, and upstream compatibility. The suite also needs durable continuity across compaction without copying raw transcript history back into context.

The target release set is:

| Package | Target | Why |
| --- | --- | --- |
| `@minhduydev/pi-core` | `0.3.1` | No contract change is required. |
| `@minhduydev/pi-subagents` | `0.12.0` | Adds multi-repo/runtime work plus the bounded task replay port; `0.11.0` is the current registry release. |
| `@minhduydev/pi-learning` | `0.6.0` | Parent-context packing changes runtime behavior and `0.5.0` already exists. |
| `@minhduydev/pi-todo` | `0.6.0` | Trusted auto-archive is default-on and `0.5.0` already exists. |
| `@minhduydev/pi-harness` | `2.6.0` | Pi migration and capability retirement are a feature release; `2.5.0` already exists. |

## Decisions and trade-offs

### Use Pi-native providers and fullscreen TUI

Remove the DeepSeek, Xiaomi/MiMo, xAI, and fullscreen compositor extensions and strip their stale settings during bootstrap upgrades.

- Benefit: one owner for auth, streams, model catalogs, terminal lifecycle, and compatibility fixes; substantially less shipped code and startup surface.
- Cost: native behavior and release cadence now follow Pi. Harness-specific provider quirks or compositor styling disappear.
- Mitigation: pin and test one Pi minor line (`>=0.84.0 <0.85.0`) and upgrade deliberately. Do not add shadow adapters unless Pi lacks a required public capability and the gap has an explicit exit condition.

### Continue after compaction by default

Enable `continueAfterCompaction` and resume after manual, threshold, or terminal non-retried overflow compaction. Do not enqueue another continuation while Pi reports `willRetry`.

- Benefit: long-running work survives context reduction without waiting for a user nudge.
- Cost: a continuation consumes another model turn and a poor summary can carry a mistaken assumption forward.
- Mitigation: coalesce timers, use a follow-up only while busy, trust the compacted summary and current worktree, and request exact old details through bounded recall instead of rehydrating raw JSONL.

### Compose replay ports instead of reading package internals

DCP loads `@minhduydev/pi-subagents/replay` dynamically and accepts only sanitized task provenance owned by the canonical project root. Todo replay and task replay enforce hard limits.

- Benefit: useful cross-session continuity without coupling the harness to companion storage layouts.
- Cost: task recall is absent when the optional companion is not installed, and lexical ranking is less expressive than semantic search.
- Mitigation: report unavailable versus invalid producer states separately, keep DCP history ranked above task provenance, omit paths/session references, and validate producer output again at the consumer boundary.

### Reuse pi-learning for durable memory

Do not add a second `MEMORY.md` injector. Use the existing trusted learning ledger and pack only whole receipt-bearing entries into a 2 KiB, non-authoritative parent context.

- Benefit: one trust/state machine, audit receipts, bounded context, and no contradictory memory owners.
- Cost: untrusted projects and entries that do not fit receive no automatic context; lexical selection can omit relevant knowledge.
- Mitigation: fail closed on trust/configuration, label the effective trust mode, expose explicit recall, and report only receipts actually emitted.

### Auto-archive Todo only in trusted projects

Default `autoArchive` to true, coalesce terminal writes, and use the existing compare-and-set lossless archive operation.

- Benefit: active TODO context remains small while terminal phases stay human-readable and recoverable.
- Cost: trusted repositories observe a file move after terminal writes; teams that want manual archival see a behavior change.
- Mitigation: never auto-mutate untrusted projects, preserve phases verbatim, flush scheduled work at lifecycle boundaries, and allow `autoArchive: false`.

### Make diagnostics honest and local

Enable automatic Fallow checks for eligible TypeScript tool results only when a configured or already-installed PATH binary exists. Resolve `auto` baselines through upstream/origin/default fallbacks, validate refs before Git, cap execution time, and surface failures.

- Benefit: useful feedback without network-time installation or silent false-clean results.
- Cost: repositories without a local analyzer receive no automatic Fallow feedback; default-on checks add bounded latency after eligible edits.
- Mitigation: no `npx` download path, path containment checks, a configurable timeout capped at 30 seconds, literal `PI_HARNESS_AUTO_FALLOW=false` opt-out, and explicit manual diagnostics.

## Release order

Publish `pi-subagents@0.12.0`, `pi-learning@0.6.0`, and `pi-todo@0.6.0` before `pi-harness@2.6.0`. Keep `pi-core@0.3.1`. Run the harness registry preflight only after all exact companion pins exist. No release script in this repository publishes automatically.

## Measured release baseline

The 2026-08-07 local ARM64 run on Node 26 loaded 15 extensions, 61 skills, 9 prompts, and 2 themes. Five local resource-loader samples had a 15.773 ms median (14.728 ms minimum; one cold 845.316 ms maximum). Portable policy plus skill descriptions measured 22,895 UTF-8 bytes / 22,801 characters, approximately 5,701 tokens using the documented `ceil(characters/4)` estimate. One hundred sequential Todo-state `stat` probes had a 0.011 ms median and 0.078 ms maximum. These are descriptive local measurements, not production latency budgets.

The packed harness payload contains 737 files, approximately 923 KiB compressed and 2.9 MiB unpacked. The migration removed roughly 13k lines of duplicate provider/compositor code while adding bounded lifecycle, replay, diagnostics, and proof contracts.

## Rejected alternatives

- Keep native and harness providers side by side: rejected because registration/auth/model ownership becomes order-dependent.
- Rebase wholesale onto `pikit-template`: rejected because it would import policy, provider, UI, and package assumptions without preserving this suite's trust and release contracts.
- Inject raw transcript/session JSONL after compaction: rejected because it defeats compaction, expands sensitive context, and couples to storage internals.
- Auto-install diagnostics with `npx`: rejected because a normal edit must not execute newly downloaded code.
- Auto-archive in untrusted projects: rejected because loading an extension must not mutate an untrusted checkout.
