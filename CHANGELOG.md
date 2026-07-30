# Changelog

All notable changes to `@minhduydev/pi-harness` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.4.1] - 2026-07-29

### Fixed

- Accept `@minhduydev/pi-todo@0.5.x` in the integration compatibility matrix so the pinned suite no longer reports false version drift.
- Expose `workflow_state` as a root JSON Schema object while retaining discriminated variant validation, fixing OpenAI-compatible subagent providers that reject root-level unions.

## [2.4.0] - 2026-07-29

### Added

- Add a generated stage/domain SuperPi router, visible-skill coverage validation, and model-seat preflight with explicit consumer remap guidance.
- Add provenance and third-party notice contracts to the package payload and release validation.
- Extend the packed Phase 5 gate with a file-backed `applySignal` outcome sink and restart replay assertion, proving durable exactly-once application instead of only counting an in-memory callback.

### Changed

- Consolidate architecture guidance, demote natural user-invoked workflows from automatic routing, and enforce one lifecycle stage plus at most one domain overlay.
- Thin lifecycle prompts around single ownership, preserve research status, and use portable repository lookup and verification wording.
- Pin `@minhduydev/pi-core@0.3.1` and `@minhduydev/pi-todo@0.5.0`; the Todo package now provides filtered views, lossless terminal-phase archives, and explicit canonical-format migration.

### Fixed

- Normalize legacy DCP state during load and keep canonical bootstrap commands executable in documentation smoke tests.

## [2.3.2] - 2026-07-29

### Fixed

- Correct package author metadata to `minhduydev <minhduy.dev@gmail.com>` before npm publication.

## [2.3.1] - 2026-07-29

### Fixed

- Pin `@minhduydev/pi-todo@0.4.2`, whose README install example now matches its supported pi-core range and passes the package publish gate.

## [2.3.0] - 2026-07-29

### Added

- Add V2 launch-time learning intents and completion-time verifier evidence binding across the suite.
- Extend the packed Auto-safe E2E through learning persistence, restart-safe retrieval, real task injection, durable usage receipts, and positive outcome recording.

### Fixed

- Await the correlated asynchronous learning context handshake so production subagents receive matching ContextPacks instead of racing a synchronous listener check.
- Use the shared pi-core protocol constant and privacy-safe retrieval telemetry without exposing prompt text, learning content, paths, raw errors, or caller-controlled correlation IDs.

### Changed

- Pin `@minhduydev/pi-core@0.3.0`, `@minhduydev/pi-subagents@0.11.0`, `@minhduydev/pi-learning@0.5.0`, and the pi-core-compatible `@minhduydev/pi-todo@0.4.1`; widen the matching peer ranges.

## [2.2.0] - 2026-07-29

### Security

- Enforce fail-closed read-only subagent capability boundaries and terminal/SDK effective-tool parity through `@minhduydev/pi-subagents@0.10.2`.
- Require verified lifecycle evidence before work-session closure and preserve explicit degraded-mode behavior for unavailable integrations.

### Added

- Integrate `@mrclrchtr/supi-ask-user@4.0.0` into the Full profile with clean packed-consumer coverage for registration, sequential execution, and the non-TUI guard.
- Add canonical standalone-agent result envelopes, Snap Edit multi-operation atomicity coverage, and startup/context/polling benchmark baselines.

### Changed

- Lifecycle prompts now use focused `ask_user` decision forms with numbered plain-text fallbacks.
- Normalize optional integration metadata and template-root documentation across source and initialized consumers.
- Separate deterministic offline release verification from the network-dependent audit gate.

### Fixed

- Remove retired prompt/tool names, invalid brownfield next steps, inert agent skill metadata, and the nonexistent `multi_grep` contract.
- Reconcile canonical model-seat policy, APPEND_SYSTEM delivery, disabled-by-default TUI behavior, bootstrap preconditions, and skill authoring templates with the implemented runtime.

## [2.1.0] - 2026-07-28

### Added

- Added the exact `@sting8k/pi-srcwalk@1.2.8` companion package and a version-resilient srcwalk skill.
- Added a global srcwalk-first navigation rule to the parent runtime policy and all seven standalone agent profiles.
- Added a Pi 0.81.1-compatible port of `pi-snap-edit@4.2.2` with guarded atomic `quick_edit` and `target_edit` tools.
- Added focused coverage for tool registration, active-tool replacement, valid guarded edits, atomic rejection, target replacement, and read-output line numbering.

### Changed

- Full-profile initialization now enables Snap Edit as a managed extension gate, replacing active `edit`/`substitute_edit` with `quick_edit`/`target_edit`.
- Documented upstream provenance, the single TypeBox import adaptation, re-vendoring steps, and the required external srcwalk installation.

## [2.0.0] - 2026-07-28

A breaking consumer-bootstrap release: `pi-harness-init` now has one Full contract and materializes the complete portable harness policy/resources into each consumer repository with exact project-local package pins and lock-aware upgrades.

### Added
- Full-only consumer bootstrap with exact `@minhduydev/pi-harness@2.0.0` and coherent companion pins; consumers no longer depend on a manual/global harness installation.
- Sentinel-managed `.pi/APPEND_SYSTEM.md`, separate managed `.pi/ANTI_PATTERNS.md`, all canonical agents, every `.pi/templates/` file, artifact ignore state, root runtime-state ignores, and `.pi/pi-harness.lock.json` SHA-256 ownership baselines.
- Convergent reruns, dry-run previews, update/delete baselines, consumer-prose preservation, and explicit non-destructive conflicts for modified managed resources.
- Clean packed-consumer checks covering Full settings, self-pins, policy/catalog/agent/template materialization, idempotent reruns, and durable task completion.

### Changed
- `pi-harness-init` supports one capability mode: Full. The incomplete `--no-agents` path is removed, Full-owned extension gates are repaired on rerun, and the target must be an existing non-symlink directory.
- Canonical agent seats intentionally keep explicit model pins for reproducible delegation; consumers may customize them and lock-aware upgrades preserve the changes.
- Suite integration moves to `@minhduydev/pi-subagents@0.10.1`; package version advances to `2.0.0`.
- Full profile, lifecycle, package payload, release validation, and consumer documentation now share one contract.

### Fixed
- Ownership-lock stale paths can no longer traverse outside managed agent/template roots.
- Symlinked managed ancestors are rejected before reads or writes, preventing bootstrap writes from escaping the target repository.
- Git/npm package identity migration replaces stale harness pins without deleting similarly named consumer packages.
- The Auto-safe fail-open E2E now captures and asserts its deliberate synthetic listener error instead of printing a misleading stack trace.
- Package release validation now agrees with the intentional canonical agent model-pin contract.

## [1.2.0] - 2026-07-27

A new typed workflow-state extension, a consolidated skill set, and release
tooling that makes the suite's publish order and peer compatibility
machine-checked. The harness now consumes the 0.2.0 / 0.9.0 / 0.4.0 / 0.4.0
suite, so the integration matrix, peer ranges, and suite pins all move
forward together.

### Added
- **`workflow-state` extension**: durable foundation verdicts, reconcile checkpoints, and complete handoffs validated by `@minhduydev/pi-core`; a reconcile trigger with CAS consume, a four-completion threshold, and a real inter-process file lock. Ships with a multi-process contention fixture (`reconcile-contention.test.ts`) that proves the CAS consume and `seenEventIds` dedup under genuine concurrency.
- **Skill consolidation**: 12 source skills merged into natural-named reference sets under surviving skills (frontend-design, context-engineering, security-and-hardening, etc.); see `.pi/skills/superpi/MIGRATIONS.md`.
- **Release tooling**: `quality-ratchet`, `suite-pins`, `registry-preflight`, `discover-gates`, and a two-mode `release-check` (local packs siblings; registry requires the exact pins on npm).
- **Docs**: `docs/workflow-state.md`, `docs/harness-profiles.md`, `docs/quality-ratchet.md`.
- **Tests**: `prompt-portability`, `skill-consolidation`, `release-modes`, `workflow-contracts`, `quality-ratchet`.

### Changed
- Integration `COMPATIBILITY` matrix and `peerDependencies` moved to `@minhduydev/pi-core ^0.2.0`, `pi-subagents >=0.9.0 <0.10.0`, `pi-learning >=0.4.0 <0.5.0`, `pi-todo >=0.4.0 <0.5.0`.
- `.pi/settings.json` and `templates/consumer-settings.json` suite pins bumped to the 0.2.0 / 0.9.0 / 0.4.0 / 0.4.0 release.
- README install commands and publish order bumped to 1.2.0.

### Fixed
- The auto-safe release E2E now awaits pi-learning's v2 `context-served` event (and the v1 binding signal) instead of a `contextRequest.response` promise that pi-learning 0.4 no longer sets, so the release gate is green against the 0.4.0 suite. The shared wait helpers live in `scripts/lib/auto-safe-e2e-helpers.ts` to keep the E2E under the quality ratchet's file-size limit.