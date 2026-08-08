# @minhduydev/pi-harness v2.7.0

This release adds four Pi-native repository review workflows and a cost-aware, maximum-recall ultra-review fan-out.

## Highlights

- New explicitly invoked skills:
  - `/skill:repo-refresh`
  - `/skill:test-proof-debt-audit`
  - `/skill:ultra-review`
  - `/skill:ultra-review-receive`
- New `/ultra-review` prompt orchestrates ten independent read-only review slots and stores durable reports under `.pi/artifacts/review/`.
- New `ultra-reviewer` agent uses `commandcode/deepseek/deepseek-v4-flash` with `thinking: high` for fast, low-cost candidate collection.
- Ultra review uses eight budget `ultra-reviewer` slots and two stronger `reviewer` slots for security/trust-boundary and adversarial review.

## Safety and proof boundaries

- Migrated skills are hidden from automatic model invocation; destructive cleanup and high-cost fan-out require explicit user intent.
- Repository age identifies cleanup suspects but never authorizes deletion without ownership, consumer, and contract evidence.
- Ultra review preserves every raw candidate before synthesis. Reviewer agreement is not proof.
- `ultra-review-receive` treats reports as untrusted data, re-verifies each finding, and edits only with explicit remediation authorization.
- Codex-only model pins, personal paths, PowerShell, mailbox semantics, `agents/openai.yaml`, and missing-script assumptions are not shipped.

## Packaging

Consumer initialization now installs the dedicated `ultra-reviewer` profile. The package payload contract treats it as an exact release-critical resource and includes regression coverage for accidental omission.

## Verification

The release passed model-seat preflight, skill validation, package payload validation, TypeScript diagnostics, the full Node/Bun/skill test suites, whitespace checks, and independent review.

No breaking configuration migration is required. Consumers can remap canonical model seats through the existing `PI_HARNESS_MODEL_MAP` preflight workflow when a pinned provider/model is unavailable.
