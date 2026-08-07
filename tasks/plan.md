# Implementation Plan: Pi 0.84 Native Harness Refresh

## Discovery

- `pi-harness` and `opencodekit/pikit-template` diverged hundreds of commits ago, so capabilities must be adapted rather than merged wholesale.
- Pi `v0.84.0` natively provides DeepSeek, xAI OAuth/API-key, Xiaomi/MiMo, and fullscreen TUI support. Its official contract also changes `ProviderHeaders` values to `string | null` and requires extensions to forward deletion markers unchanged.
- A forced compatibility run against Pi 0.84 passed 1,344 existing tests across `pi-harness`, `pi-subagents`, `pi-todo`, and `pi-learning`; the only TypeScript blocker was the DCP compaction header contract.
- Local `pi-subagents` is `0.12.0` with durable multi-repo execution, while consumer settings still pin the published `0.11.0`. The final release must publish `pi-subagents` first and then pin `0.12.0` in `pi-harness`.
- Local `pi-todo` already has lossless idempotent archival, so upstream's destructive completed-block pruning should become bounded auto-archive rather than deletion.
- DCP already owns compaction and recall. Auto-resume and task provenance belong at that boundary; raw transcript/history parsing should stay behind typed adapters.
- `.pi/MEMORY.md` is project-authored but can still contain stale or instruction-like text. A second injector would duplicate the learning boundary, so reusable context stays behind `pi-learning`'s bounded, receipt-bearing, non-authoritative parent-context contract.
- The custom provider and TUI trees account for substantial maintenance surface while being disabled or superseded by Pi 0.84 native behavior.

## Architecture Decisions

- Target one host line: Pi `0.84.x`, exact `0.84.0` development dependencies, peer range `>=0.84.0 <0.85.0`, and TypeBox `1.3.7`.
- Remove redundant provider and custom TUI extensions instead of maintaining adapters or compatibility shims.
- Keep canonical agent model seats unchanged when they refer to external providers; removing bundled provider registration must not silently remap consumer model choices.
- Default compaction continuation to enabled, but keep bounded coalescing, native retry avoidance, shutdown cancellation, and no raw JSONL reread prompt.
- Add optional, additive public contracts for task recall and TODO retention, and reuse the existing learning contract for bounded parent context. Existing on-disk schemas remain readable.
- Prefer lossless archive and bounded retrieval over deletion or unbounded system-prompt injection.

## Task List

### Phase 1: Host and native capability foundation

- [x] Task 1: Add contract tests for the Pi 0.84 peer/dev dependency matrix and nullable provider headers.
- [x] Task 2: Upgrade `pi-harness`, `pi-subagents`, `pi-todo`, and `pi-learning` to Pi 0.84/TypeBox 1.3.7 and refresh lockfiles.
- [x] Task 3: Remove bundled DeepSeek, MiMo, xAI, and custom TUI resources plus gates, tests, docs, and payload references.
- [x] Task 4: Pin the future `pi-subagents@0.12.0` consumer release and document release ordering.

### Checkpoint: Foundation

- [x] Focused package/settings tests pass.
- [x] All four Pi-consuming repositories typecheck on Pi 0.84.
- [x] Packed harness contains no retired provider/TUI resources.

### Phase 2: Lifecycle and recall

- [x] Task 5: Add hardened continue-after-compaction behavior, enabled by default, with retry/coalescing/shutdown tests.
- [x] Task 6: Add a typed optional `pi-subagents` task-replay adapter to DCP recall with project/path bounds and provenance tests.
- [x] Task 7: Reject a duplicate `MEMORY.md` injector and use `pi-learning`'s trust-labelled, receipt-preserving 2 KiB parent-context boundary instead.

### Checkpoint: Lifecycle

- [x] DCP focused tests and extension typechecks pass.
- [x] No continuation is sent when Pi will retry natively.
- [x] Recall and learning-context inputs remain path-free, non-authoritative, and bounded.

### Phase 3: Package behavior

- [x] Task 8: Add typed TODO retention settings and lossless automatic archival after startup/mutation, with fail-closed parsing and idempotency tests.
- [x] Task 9: Expose the minimum stable task provenance query surface from `pi-subagents` without leaking run-store internals.

### Checkpoint: Packages

- [x] `pi-todo` and `pi-subagents` focused, full, build, pack/install tests pass.
- [x] Existing v1/on-disk records remain readable.

### Phase 4: Prompt, verification, quality, and diagnostics

- [x] Task 10: Add portable repository-root resolution and apply it to artifact-writing prompts.
- [x] Task 11: Replace mandatory XML verification output with concise Result/Evidence/Limits while tightening zero-open-item and independent-review gates.
- [x] Task 12: Extend skill evaluation fixtures with version/model/prompt/harness provenance; keep fixture integrity distinct from live behavior claims.
- [x] Task 13: Harden diagnostics baseline resolution and only then enable bounded local auto-Fallow behavior.

### Checkpoint: Policy and quality

- [x] Skill/prompt validation passes.
- [x] Diagnostics reports baseline failures honestly and does not return false-green JSON.
- [x] Performance measurements are recorded for new hot-path injections and diagnostics.

### Phase 5: Final review and release readiness

- [x] Task 14: Update README, changelogs, migration notes, ADR, settings template, and package payload contracts.
- [x] Task 15: Run each repository's full check, npm audit, dry-run pack, isolated install smoke, and scoped five-axis review.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Pi 0.84 provider/runtime break | High | Isolate dependency migration, use official types/changelog, run package and manual smokes |
| Removing a provider also removes unique tools | Medium | Verify references and native replacement; document intentionally removed surface |
| Auto-continuation creates runaway turns | High | One coalesced pending continuation, ignore native retry, clear on settled/shutdown |
| Memory/task text injects instructions | High | Treat as untrusted context, label non-authoritative, trust gate, byte/item caps |
| TODO retention loses history | High | Archive only through existing CAS/durable path; never silently delete |
| Registry release ordering causes install failure | High | Publish `pi-subagents@0.12.0` before the harness that pins it |
| Broad change obscures regressions | High | Thin slices, focused RED/GREEN tests, full checkpoint between phases |

## Open Questions

- None blocking. npm publication is complete; source tags and GitHub releases are handled by the release workflow after registry verification.
