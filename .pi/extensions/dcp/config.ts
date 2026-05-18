/**
 * DCP Extension — Configuration (v2)
 *
 * Default configuration and types for the Dynamic Context Pruning extension.
 * v2 adds runtime-enforced strategies, cache-aware drops, tagging, fact extraction,
 * smart compaction, and a real nudge system — all built on Pi's native extension API.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Permission = "ask" | "allow" | "deny";
export type NudgeForce = "strong" | "soft";
export type NotificationLevel = "off" | "minimal" | "detailed";
export type CompressMode = "range" | "message";

export interface CompressConfig {
	permission: Permission;
	maxContextLimit: number;
	minContextLimit: number;
	nudgeFrequency: number;
	iterationNudgeThreshold: number;
	nudgeForce: NudgeForce;
	protectedTools: string[];
	protectUserMessages: boolean;
	mode: CompressMode;
	summaryBuffer: number;
	flatSchema: boolean;
}

export interface ManualModeConfig {
	enabled: boolean;
	automaticStrategies: boolean;
}

export interface TurnProtectionConfig {
	enabled: boolean;
	/** Minimum number of recent assistant+user message turns to keep raw (uncompressed) */
	turns: number;
}

export interface ExperimentalConfig {
	customPrompts: boolean;
	allowSubAgents: boolean;
}

export interface DeduplicationConfig {
	enabled: boolean;
	protectedTools: string[];
}

export interface PurgeErrorsConfig {
	enabled: boolean;
	/** Number of turns to wait before purging errored tool inputs */
	turns: number;
	protectedTools: string[];
}

export interface StrategiesConfig {
	deduplication: DeduplicationConfig;
	purgeErrors: PurgeErrorsConfig;
}

// ---------------------------------------------------------------------------
// Phase 2: Cache-aware drop queue config
// ---------------------------------------------------------------------------

export interface CacheTTLConfig {
	/** Default cache TTL in milliseconds (default: 5 minutes) */
	defaultMs: number;
	/** Per-model overrides: model name/pattern → TTL in ms */
	perModel: Record<string, number>;
}

export interface DropQueueConfig {
	enabled: boolean;
	/** Cache TTL settings — drops are deferred until TTL expires */
	cacheTTL: CacheTTLConfig;
	/** Context usage % that forces queue execution regardless of TTL */
	executeThresholdPercent: number;
	/** Last N tags immune from immediate drop */
	protectedTags: number;
}

// ---------------------------------------------------------------------------
// Phase 2: Tagging config
// ---------------------------------------------------------------------------

export interface TaggingConfig {
	enabled: boolean;
}

// ---------------------------------------------------------------------------
// Phase 2: Fact extraction config
// ---------------------------------------------------------------------------

export type FactCategory =
	| "ARCHITECTURE_DECISIONS"
	| "CONSTRAINTS"
	| "NAMING_CONVENTIONS"
	| "KNOWN_ISSUES"
	| "WORKFLOW_RULES"
	| "DEPENDENCIES"
	| "FILE_PATTERNS"
	| "API_CONTRACTS";

export interface FactExtractionConfig {
	enabled: boolean;
	/** Categories to extract */
	categories: FactCategory[];
	/** Retrieval count threshold for promotion to permanent memory */
	promotionThreshold: number;
}

// ---------------------------------------------------------------------------
// Phase 2: Expand (reversible compression) config
// ---------------------------------------------------------------------------

export interface ExpandConfig {
	enabled: boolean;
	/** Max tokens to return when expanding a compressed range */
	maxExpandTokens: number;
}

// ---------------------------------------------------------------------------
// Phase 3: Background historian config
// ---------------------------------------------------------------------------

export interface HistorianConfig {
	enabled: boolean;
	/** Model to use for background summarization (e.g. "haiku") */
	model: string;
	/** Timeout per historian call in ms */
	timeoutMs: number;
	/** Token budget for historian input chunk */
	chunkTokenBudget: number;
}

// ---------------------------------------------------------------------------
// Phase 1: Auto-compact config
// ---------------------------------------------------------------------------

export interface AutoCompactConfig {
	enabled: boolean;
	/** Context usage % threshold to trigger auto ctx.compact() */
	thresholdPercent: number;
	/** Custom instructions for auto-compaction */
	customInstructions: string;
	/**
	 * Cancel Pi's native auto-compaction via session_before_compact.
	 * When true, DCP returns { cancel: true } to prevent Pi from running
	 * its own compaction, giving the user full manual control via the
	 * compress tool. Pi's overflow recovery is still allowed.
	 *
	 * Options:
	 *   - "always": Always cancel native compaction (full manual control)
	 *   - "when-managed": Cancel only when DCP has active compression blocks
	 *   - "never": Never cancel (current default behavior)
	 */
	cancelNativeCompaction: "always" | "when-managed" | "never";
	/**
	 * Fallback models to try for enriched compaction when the primary model
	 * fails (e.g. rate-limited / 429). Tried in order before deferring to
	 * Pi native compaction. Activated even when `cancelNativeCompaction` is
	 * "when-managed" and there are no active DCP blocks, so context overflow
	 * recovery has a fighting chance when the primary quota is exhausted.
	 *
	 * Each entry must match a provider+model registered in the Pi model
	 * registry (ctx.modelRegistry.find). Set to [] to disable.
	 */
	fallbackModels?: Array<{ provider: string; modelId: string }>;
}

// ---------------------------------------------------------------------------
// Tool output offloading config (v3, TencentDB-inspired)
// ---------------------------------------------------------------------------

export interface OffloadConfig {
	enabled: boolean;
	/** Minimum token count to trigger offloading (default: 1000 ≈ 4KB text) */
	minTokens: number;
	/** Max ref files per session (oldest purged) */
	maxRefsPerSession: number;
	/** Tools whose results should NOT be offloaded */
	protectedTools: string[];
}

// ---------------------------------------------------------------------------
// Main config type
// ---------------------------------------------------------------------------

export interface DCPConfig {
	enabled: boolean;
	debug: boolean;
	pruneNotification: NotificationLevel;
	protectedFilePatterns: string[];
	compress: CompressConfig;
	strategies: StrategiesConfig;
	manualMode: ManualModeConfig;
	turnProtection: TurnProtectionConfig;
	experimental: ExperimentalConfig;

	// v2 additions
	dropQueue: DropQueueConfig;
	tagging: TaggingConfig;
	factExtraction: FactExtractionConfig;
	expand: ExpandConfig;
	historian: HistorianConfig;
	autoCompact: AutoCompactConfig;

	// v3: Tool output offloading
	offload: OffloadConfig;
}

// ---------------------------------------------------------------------------
// Protected tools (always protected from pruning)
// ---------------------------------------------------------------------------

/** @internal Full list of tools that should never be pruned (for reference) */
export const DEFAULT_PROTECTED_TOOLS: readonly string[] = [
	// File mutations
	"write",
	"edit",
	// Context management
	"compress",
	// Memory persistence
	"observation",
	"memory-update",
	"memory-read",
	// Task management (Pi tool names)
	"TaskCreate",
	"TaskUpdate",
];

/**
 * Tools whose results are auto-preserved in compression summaries.
 * Keep this list to tools with SMALL, HIGH-VALUE outputs.
 * Tools with large outputs (write/edit diffs) go in deduplication.protectedTools instead.
 */
export const COMPRESS_PROTECTED_TOOLS: readonly string[] = [
	// Context management
	"compress",
	// Memory persistence
	"observation",
	"memory-update",
	// Task management (Pi tool names)
	"TaskCreate",
	"TaskUpdate",
];

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: DCPConfig = {
	enabled: true,
	debug: false,
	pruneNotification: "detailed",
	protectedFilePatterns: [
		".env*",
		"AGENTS.md",
		".pi/**",
		".beads/**",
		"package.json",
		"tsconfig.json",
	],
	compress: {
		permission: "allow",
		maxContextLimit: 150_000,
		minContextLimit: 50_000,
		nudgeFrequency: 5,
		iterationNudgeThreshold: 15,
		nudgeForce: "soft",
		protectedTools: [...COMPRESS_PROTECTED_TOOLS],
		protectUserMessages: false,
		mode: "range",
		summaryBuffer: 20_000,
		flatSchema: false,
	},
	strategies: {
		deduplication: {
			enabled: true,
			// write/edit protected from dedup (file mutations are unique operations)
			// but NOT in compress.protectedTools (their diff outputs are too large for auto-preserve)
			protectedTools: ["write", "edit"],
		},
		purgeErrors: {
			enabled: true,
			turns: 4,
			protectedTools: [],
		},
	},
	manualMode: {
		enabled: false,
		automaticStrategies: true,
	},
	turnProtection: {
		enabled: true,
		turns: 1,
	},
	experimental: {
		customPrompts: false,
		allowSubAgents: false,
	},

	// v2: Cache-aware deferred drop queue
	dropQueue: {
		enabled: true,
		cacheTTL: {
			defaultMs: 5 * 60 * 1000, // 5 minutes
			perModel: {
				// Claude Max has longer cache windows
				"claude-sonnet-4-0": 10 * 60 * 1000,
				"claude-opus-4-0": 10 * 60 * 1000,
			},
		},
		executeThresholdPercent: 65,
		protectedTags: 20,
	},

	// v2: Monotonic message tagging
	tagging: {
		enabled: true,
	},

	// v2: Fact extraction from compaction
	factExtraction: {
		enabled: true,
		categories: [
			"ARCHITECTURE_DECISIONS",
			"CONSTRAINTS",
			"NAMING_CONVENTIONS",
			"KNOWN_ISSUES",
			"WORKFLOW_RULES",
			"DEPENDENCIES",
			"FILE_PATTERNS",
			"API_CONTRACTS",
		],
		promotionThreshold: 3,
	},

	// v2: Reversible compression (ctx_expand)
	expand: {
		enabled: true,
		maxExpandTokens: 15_000,
	},

	// v3: Background historian
	historian: {
		enabled: false, // Off by default — opt-in
		model: "haiku",
		timeoutMs: 300_000, // 5 minutes
		chunkTokenBudget: 20_000,
	},

	// v2: Auto-compact via ctx.compact()
	autoCompact: {
		enabled: true,
		thresholdPercent: 80,
		customInstructions: "Focus on preserving: key decisions, file paths modified, current task state, and next steps. Be thorough but concise.",
		cancelNativeCompaction: "when-managed",
		// Try Haiku on Copilot as the first fallback — cheaper quota bucket than Sonnet,
		// so a Sonnet 429 does not cascade into a total compaction failure.
		fallbackModels: [{ provider: "github-copilot", modelId: "claude-haiku-4.5" }],
	},

	// v3: Tool output offloading (inspired by TencentDB-Agent-Memory short-term offload)
	offload: {
		enabled: true,
		minTokens: 1000,
		maxRefsPerSession: 50,
		protectedTools: ["compress", "write", "edit", "observation", "memory-update"],
	},
};
