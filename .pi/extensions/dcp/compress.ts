/**
 * DCP Extension — Compress Module (Barrel)
 *
 * Re-exports every symbol previously exported by the monolithic compress.ts.
 * Importers using `from "./compress"` continue working without changes.
 */

// Types & Constants
export {
  DCP_STATE_ENTRY_TYPE,
  isCompactableTool,
  READ_TOOLS,
  MODIFY_TOOLS,
} from "./compress-types.js";
export type {
  DcpStateEntryPayload,
  DCPCompressedSummaryMessage,
  BashExecutionMessage,
  CompactionSummaryMessage,
  BranchSummaryMessage,
  StructuredSummaryFields,
  PersistentSessionSummary,
  ArtifactTrackerEntry,
  ProbeResult,
  ProbeEvaluationResult,
  RegressionEvent,
  QualityMetricsData,
  CompressionBlock,
  ToolOp,
  SessionState,
} from "./compress-types.js";

// State Management
export {
  getDcpSessionId,
  getState,
  getPersistentSummary,
  getQualityMetrics,
  makeDcpStateEntryPayload,
  restoreDcpStateSnapshot,
  restoreDcpStateFromSessionEntries,
  cleanupSession,
  incrementTurn,
  addBlock,
  getBlocks,
  getStats,
} from "./compress-state.js";

// Summary / Probes
export {
  mergeIntoPersistentSummary,
  evaluateCompressionProbes,
  recordProbeResults,
  buildCompressedSummaryMessage,
  extractStructuredFields,
} from "./compress-summary.js";

// Quality Metrics
export {
  trackToolCall,
  getArtifactTracker,
  extractPathFromArgs,
  detectReadRegression,
  checkCompressionRegression,
  recordCompressEvent,
  recordCompressFiles,
  markArtifactsCompressed,
  getQualityStatus,
  evaluateQuality,
} from "./compress-metrics.js";

// Token Estimation / Context Processing / Pruning
export {
  estimateTokens,
  partitionCompressibleMessages,
  estimateOutboundContextTokens,
  estimateTokensAfterCompress,
  enrichCompactionResult,
  extractToolOps,
  stripToolArgs,
  processContextMessages,
  runContextStrategies,
  computeRunPruneStats,
} from "./compress-tokens.js";

// Tool Registration
export { registerCompressTool } from "./compress-tool.js";
