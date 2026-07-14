/**
 * DCP Extension — Compress Module (Barrel)
 *
 * Re-exports every symbol previously exported by the monolithic compress.ts.
 * Importers using `from "./compress"` continue working without changes.
 */

// Types & Constants
export {
  DCP_STATE_ENTRY_TYPE,
  READ_TOOLS,
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
      LegacyAttestationMetadata,
      ToolOp,
      SessionState,
    } from "./compress-types.js";

    // State Management
    export {
      addBlock,
      attestBlock,
      captureProvenance,
      cleanupSession,
      getBlocks,
      getDcpSessionId,
      getLegacyStatus,
      getProvenanceCounts,
      getQualityMetrics,
      getPersistentSummary,
      getQuarantinedBlocks,
      getState,
      getStats,
      incrementTurn,
      isLegacyBlock,
      makeDcpStateEntryPayload,
      persistState,
      quarantineLegacyBlocks,
      restoreDcpStateFromSessionEntries,
      validateBlocksProvenance,
      validateBlockProvenance,
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
  checkCompressionRegression,
  recordCompressEvent,
  getQualityStatus,
} from "./compress-metrics.js";

// Token Estimation / Context Processing / Pruning
export {
  estimateTokens,
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
