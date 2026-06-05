/**
 * DCP Extension — Configuration
 *
 * Pure data: types + defaults. No runtime dependencies.
 */

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

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
  /** Context % threshold for auto-compaction */
  thresholdPercent: number;
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

export interface DCPConfig {
  enabled: boolean;
  compress: CompressConfig;
  dedup: DedupConfig;
  purgeErrors: PurgeErrorsConfig;
  autoCompact: AutoCompactConfig;
  structuredSummary: StructuredSummaryConfig;
  artifactTracking: ArtifactTrackingConfig;
  probeEvaluation: ProbeConfig;
  qualityMetrics: QualityMetricsConfig;
  debug: boolean;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_PROTECTED_TOOLS: readonly string[] = [
  "write", "edit", "compress", "observation",
  "memory-search", "TaskCreate", "TaskUpdate",
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
  qualityMetrics: {
    enabled: true,
    regressionWindow: 5,
    trackReReads: true,
  },
};
