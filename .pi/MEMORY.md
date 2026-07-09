# Memory

- 2026-07-09: xAI provider default model is now `grok-4.5` via `.pi/extensions/xai/constants.ts`.
- 2026-07-09: xAI model metadata in `.pi/extensions/xai/models.ts` includes `grok-4.5` with 500k context and pricing aligned to xAI docs.
- 2026-07-09: xAI payload rewriting in `.pi/extensions/xai/payload.ts` normalizes unsupported reasoning levels for `grok-4.5`: `minimal` -> `low`, and `off`/`none` -> `low`, because xAI docs say Grok 4.5 reasoning cannot be disabled.
- 2026-07-09: [bugfix] Ported pi-xai-oauth@1.2.6 image param fix (167db38) into local fork `.pi/extensions/xai/tools/image-tools.ts`: `xai_generate_image` no longer sends `size` or default `n`; rejects legacy `size`; validates `n` as integer 1-4 and only forwards when set.
- 2026-07-09: [cleanup] Whole-tree aislop auto-fix pass: 0 errors / 0 fixable remain (was 5 errors + ~184 fixable). xAI tools split into define-tool/image-tools/research-tools/register; shared `requireXaiAuthToken`; payload hoist/reasoning helpers. Remaining ~80 warnings are structural (dcp/deepseek oversized files, intentional API URL constants, type seams).
- 2026-07-09: DCP compaction auto-continue gap is expected with the current design: `.pi/extensions/dcp/index.ts` proactively calls `ctx.compact()` from `turn_end` after crossing the threshold, which produces `reason: "threshold"`; Pi docs say only `overflow` compactions retry the interrupted turn, so threshold/manual compactions do not auto-continue.
- 2026-07-09: [bugfix] DCP now relies on Pi's native overflow compaction instead of proactive threshold `ctx.compact()`. `.pi/extensions/dcp/index.ts` keeps `session_before_compact` customization but no longer calls `ctx.compact({ reason: "threshold" })`; regression coverage lives in `.pi/extensions/dcp/index.test.ts`.
