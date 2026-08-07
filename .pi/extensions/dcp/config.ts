/**
 * DCP Extension — Configuration
 *
 * Pure data: types + defaults. No runtime dependencies.
 */

export type CompressMode = "range" | "message";
export type NudgeForce = "strong" | "soft";
export type Permission = "ask" | "allow" | "deny";

export interface CompressConfig {
  /** Whether the compress tool is available to the LLM */
  permission: Permission;
  /** Compression mode: "range" (default) or "message" (experimental) */
  mode: CompressMode;
  /** Context usage % threshold for gentle nudges (default: 50%) */
  minContextLimit: number;
  /** Context usage % threshold for critical nudges (default: 75%) */
  maxContextLimit: number;
  /** How many turns between nudges (1 = every turn, 5 = every 5th) */
  nudgeFrequency: number;
  /** Turns to suppress ALL nudges after a compress event */
  compressNudgeCooldown: number;
  /** Nudge tone: "strong" (WARNING) or "soft" (gentle reminder) */
  nudgeForce: NudgeForce;
  /** Tools whose outputs are preserved in compression summaries */
  protectedTools: string[];
  /** Preserve user messages verbatim through compression */
  protectUserMessages: boolean;
  /** Active summary tokens that extend the effective maxContextLimit */
  summaryBuffer: number;
}

export interface DedupConfig {
  enabled: boolean;
  protectedTools: string[];
}

export interface PurgeErrorsConfig {
  enabled: boolean;
  /** Turns before errored tool inputs are stripped */
  turns: number;
  protectedTools: string[];
}

export interface AutoCompactConfig {
  enabled: boolean;
  /** Context % threshold (Pi branch meter via getContextUsage) for Zone 4 pressure */
  thresholdPercent: number;
  /** Optional 0-1 ratio; when set, threshold = contextWindow * ratio. */
  thresholdRatio?: number;
  /**
   * When true, rely on Pi's native overflow compaction instead of the legacy critical nudge.
   * DCP still hooks session_before_compact when deterministicCompaction is enabled.
   * When false, only inject the critical nudge (legacy behavior).
   */
  invokeNativeCompact: boolean;
  /** Deprecated compatibility setting. Pi branch usage exclusively drives nudges and auto-compaction. */
  pressureSource: "branch" | "outbound" | "max";
}

export interface StructuredSummaryConfig {
  enabled: boolean;
  /** Auto-extract file paths from summary text as fallback when LLM doesn't provide structured fields */
  autoExtractPaths: boolean;
}

export interface ArtifactTrackingConfig {
  enabled: boolean;
  /** Max files to track per session (LRU eviction) */
  maxFiles: number;
}

export interface ProbeConfig {
  enabled: boolean;
  /** Minimum score (0-100) for file coverage probe */
  minFileCoverage: number;
  /** Minimum score (0-100) for decision coverage probe */
  minDecisionCoverage: number;
  /** Minimum score (0-100) for narrative depth probe */
  minNarrativeDepth: number;
  /** Minimum score (0-100) for structure completeness probe */
  minStructureCompleteness: number;
  /** Show probe results in compress tool response */
  showInResponse: boolean;
  /** Include probe quality feedback in nudges when probes fail */
  nudgeOnFailure: boolean;
}

export interface QualityMetricsConfig {
  enabled: boolean;
  /** Turns after which a compress regression guard expires */
  regressionWindow: number;
  /** Track re-reads as quality signal */
  trackReReads: boolean;
}

    export interface ToolResultPruningConfig {
      enabled: boolean;
      /** Total estimated token threshold to trigger pruning (default: 40_000) */
      thresholdTokens: number;
      /** Number of most recent turns to protect from pruning */
      protectedRecentTurns: number;
      /** Override list of compactable tool names (defaults to built-in list) */
      compactableTools: string[];
      /** Tool names protected from pruning by all strategies */
      protectedTools: string[];
    }

export interface DeterministicCompactionConfig {
  enabled: boolean;
  /** Own Pi compaction instead of delegating to Pi's default LLM summarizer */
  overrideNative: boolean;
  /** Number of transcript lines kept in the compacted summary */
  maxTranscriptLines: number;
  /** Maximum item count per semantic section */
  maxSectionItems: number;
}

export interface SemanticEnrichmentConfig {
  /** Optional LLM digest. Disabled by default so DCP is deterministic/cost-free like pi-vcc. */
  enabled: boolean;
  /** Provider/model name; empty means use Pi's default provider when a provider hook is available. */
  provider: string;
}

export interface ProtectionConfig {
  /** Glob patterns for file paths whose tool call+result are protected from compression strategies */
  protectedFilePatterns: string[];
  /** Number of most recent tool-call turns to protect from compression strategies */
  recentTurns: number;
}

export interface RecallConfig {
  enabled: boolean;
  /** Search raw ~/.pi/agent/sessions JSONL in addition to durable DCP blocks */
  rawSessionSearch: boolean;
}

export interface CompactionContinuationConfig {
  /** Resume unfinished work after a successful compaction. */
  enabled: boolean;
  /** One-tick deferral lets Pi finish reconnecting post-compaction state. */
  delayMs: number;
}

export interface DCPConfig {
  enabled: boolean;
  compress: CompressConfig;
  dedup: DedupConfig;
  purgeErrors: PurgeErrorsConfig;
  autoCompact: AutoCompactConfig;
  structuredSummary: StructuredSummaryConfig;
  artifactTracking: ArtifactTrackingConfig;
  probeEvaluation: ProbeConfig;
  toolResultPruning: ToolResultPruningConfig;
  qualityMetrics: QualityMetricsConfig;
  deterministicCompaction: DeterministicCompactionConfig;
  semanticEnrichment: SemanticEnrichmentConfig;
  protection: ProtectionConfig;
  recall: RecallConfig;
  continuation: CompactionContinuationConfig;
  debug: boolean;
}

const DEFAULT_PROTECTED_TOOLS: readonly string[] = [
  "write",
  "edit",
  "compress",
  "TaskCreate",
  "TaskUpdate",
];

export const DEFAULT_CONFIG: DCPConfig = {
  enabled: true,
  debug: false,
  compress: {
    permission: "allow",
    mode: "range",
    maxContextLimit: 80,
    minContextLimit: 65,
    nudgeFrequency: 5,
    compressNudgeCooldown: 3,
    nudgeForce: "soft",
    protectedTools: [...DEFAULT_PROTECTED_TOOLS],
    protectUserMessages: false,
    summaryBuffer: 16_384,
  },
  dedup: {
    enabled: true,
    protectedTools: [...DEFAULT_PROTECTED_TOOLS],
  },
  purgeErrors: {
    enabled: true,
    turns: 4,
    protectedTools: [],
  },
  autoCompact: {
    enabled: true,
    thresholdPercent: 80,
    thresholdRatio: 0.8,
    invokeNativeCompact: true,
    pressureSource: "branch",
  },
  structuredSummary: {
    enabled: true,
    autoExtractPaths: true,
  },
  artifactTracking: {
    enabled: true,
    maxFiles: 200,
  },
  probeEvaluation: {
    enabled: true,
    minFileCoverage: 50,
    minDecisionCoverage: 50,
    minNarrativeDepth: 60,
    minStructureCompleteness: 60,
    showInResponse: true,
    nudgeOnFailure: true,
  },
      toolResultPruning: {
        enabled: true,
        thresholdTokens: 40_000,
        protectedRecentTurns: 2,
        protectedTools: [],
        compactableTools: [
      "read",
      "bash",
      "grep",
      "find",
      "ls",
      "glob",
      "webfetch",
      "websearch",
        "codesearch",
        "multi_grep",
    ],
  },
  qualityMetrics: {
    enabled: true,
    regressionWindow: 5,
    trackReReads: true,
  },
  deterministicCompaction: {
    enabled: true,
    overrideNative: true,
    maxTranscriptLines: 140,
    maxSectionItems: 24,
  },
  semanticEnrichment: {
    enabled: false,
    provider: "",
  },
  protection: {
    protectedFilePatterns: [],
    recentTurns: 3,
  },
  recall: {
    enabled: true,
    rawSessionSearch: true,
  },
  continuation: {
    enabled: true,
    delayMs: 0,
  },
};
