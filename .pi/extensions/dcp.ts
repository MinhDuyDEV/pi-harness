/**
 * DCP Extension v2 — Entry Point
 *
 * Dynamic Context Pruning for Pi coding agents.
 *
 * What this provides (that Pi's native compaction does not):
 *   - `compress` tool: LLM-initiated compression of completed conversation ranges
 *   - Nudge system: gradual context pressure between min/max thresholds
 *   - Dedup: strips duplicate tool call content to save tokens
 *   - Purge errors: strips large inputs from old errored tool calls
 *   - `session_before_compact` enrichment: injects DCP block context
 *   - `/dcp` command: status overview
 *
 * Pi still handles auto-compaction, overflow recovery, cut-point detection,
 * turn splitting, and branch summarization natively. DCP supplements, not replaces.
 *
 * No SQLite. No external dependencies. Pure in-memory state.
 */

export { default } from "./dcp/index.js";
