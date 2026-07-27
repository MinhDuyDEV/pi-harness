# Changelog

All notable changes to `@minhduydev/pi-harness` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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