# @minhduydev/pi-harness v2.6.0

This release aligns the full harness with Pi 0.84, removes provider and fullscreen UI implementations that Pi now supplies natively, and strengthens continuity, provenance, diagnostics, and release verification across the companion package suite.

## Highlights

- **Native-first Pi 0.84 migration:** retires harness-owned DeepSeek, Xiaomi/MiMo, xAI, and fullscreen compositor implementations, including stale consumer gates during upgrades.
- **Compaction continuity by default:** manual, threshold, and terminal overflow compaction resume queued work with coalescing and busy-session follow-up semantics.
- **Cross-package provenance:** bounded, sanitized task outcomes from `pi-subagents/replay` can participate in DCP recall without exposing paths, prompts, claims, or raw issue text.
- **Diagnostics hardening:** automatic git baselines are validated, Fallow runtime is bounded, and analyzer failures cannot masquerade as clean output.
- **Stronger completion contract:** prompt artifacts are repository-relative and READY requires a complete independent verification pass.
- **Suite refresh:** pins `pi-subagents@0.12.0`, `pi-learning@0.6.0`, and `pi-todo@0.6.0`, while upgrading the vendored Snap Edit integration to 5.0.0.

## Compatibility and migration

- Requires the Pi `0.84.x` host generation and TypeBox `1.3.7` compatibility contract.
- Existing consumers converge during `pi-harness-init`; obsolete provider/TUI gates are removed automatically.
- `continueAfterCompaction` remains enabled by default and can still be overridden explicitly.

## Verification

- Full local and registry release gates passed
- 153 Node extension tests and 147 Bun DCP tests passed
- 286 skill/package tests passed
- Packed Auto-safe and Phase 5 consumer E2E checks passed
- Production audit reported zero vulnerabilities
- Published npm payload matches the release source

## Links

- [CHANGELOG](CHANGELOG.md)
- [Pi 0.84 suite migration](docs/pi-084-suite-migration.md)
- [Harness profiles](docs/harness-profiles.md)
