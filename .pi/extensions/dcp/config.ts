/**
 * DCP Extension — Configuration
 *
 * Default configuration and types for the Dynamic Context Pruning extension.
 * Ported from @tarquinen/opencode-dcp.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Permission = "ask" | "allow" | "deny";
export type NudgeForce = "strong" | "soft";
export type NotificationLevel = "off" | "minimal" | "detailed";

export interface CompressConfig {
	permission: Permission;
	maxContextLimit: number;
	minContextLimit: number;
	nudgeFrequency: number;
	iterationNudgeThreshold: number;
	nudgeForce: NudgeForce;
	protectedTools: string[];
	protectUserMessages: boolean;
}

export interface DeduplicationConfig {
	enabled: boolean;
	protectedTools: string[];
}

export interface SupersedeWritesConfig {
	enabled: boolean;
}

export interface PurgeErrorsConfig {
	enabled: boolean;
	turns: number;
	protectedTools: string[];
}

export interface StrategiesConfig {
	deduplication: DeduplicationConfig;
	supersedeWrites: SupersedeWritesConfig;
	purgeErrors: PurgeErrorsConfig;
}

export interface DCPConfig {
	enabled: boolean;
	debug: boolean;
	pruneNotification: NotificationLevel;
	protectedFilePatterns: string[];
	compress: CompressConfig;
	strategies: StrategiesConfig;
}

// ---------------------------------------------------------------------------
// Protected tools (always protected from pruning)
// ---------------------------------------------------------------------------

export const DEFAULT_PROTECTED_TOOLS: readonly string[] = [
	"task",
	"skill",
	"todowrite",
	"todoread",
	"compress",
	"batch",
	"plan_enter",
	"plan_exit",
	"write",
	"edit",
	"observation",
	"memory-update",
	"memory-read",
];

export const COMPRESS_PROTECTED_TOOLS: readonly string[] = [
	"task",
	"skill",
	"todowrite",
	"todoread",
	"observation",
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
	},
	strategies: {
		deduplication: {
			enabled: true,
			protectedTools: [],
		},
		supersedeWrites: {
			enabled: true,
		},
		purgeErrors: {
			enabled: true,
			turns: 4,
			protectedTools: [],
		},
	},
};
