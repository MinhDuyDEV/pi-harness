/**
 * Memory Operation Log — Append-Only Audit Trail
 *
 * Inspired by Karpathy's LLM Wiki log.md:
 * chronological record of all memory operations for provenance tracking.
 *
 * Stored in memory_files as "log" — append-only, never overwritten.
 */

import { getMemoryFile, upsertMemoryFile } from "./maintenance.js";

// ============================================================================
// Types
// ============================================================================

export type OperationType =
	| "observation-created"
	| "observation-superseded"
	| "observation-validated"
	| "observation-rejected"
	| "observation-duplicate-warning"
	| "index-generated"
	| "lint-run"
	| "compile-run"
	| "maintenance-run"
	| "distillation-created"
	| "curation-run";

export interface LogEntry {
	timestamp: string;
	operation: OperationType;
	targets: string[];
	summary: string;
}

// ============================================================================
// Log Operations
// ============================================================================

/**
 * Append an entry to the operation log.
 * The log is append-only and stored in memory_files.
 */
export function appendOperationLog(entry: Omit<LogEntry, "timestamp">): void {
	const timestamp = new Date().toISOString().slice(0, 19);
	const targets = entry.targets.length > 0 ? entry.targets.join(", ") : "-";
	const line = `[${timestamp}] ${entry.operation} | ${targets} | ${entry.summary}`;

	// Check if log exists
	const existing = getMemoryFile("log");
	if (existing) {
		// Append with newline
		upsertMemoryFile("log", line, "append");
	} else {
		// Create with header
		const header = [
			"# Memory Operation Log",
			"",
			"> Append-only chronological record of all memory operations.",
			"> Format: [timestamp] operation | targets | summary",
			"",
			"---",
			"",
			line,
		].join("\n");
		upsertMemoryFile("log", header, "replace");
	}
}

/**
 * Get recent log entries (parsed from the log file).
 */
export function getRecentLogEntries(limit = 20): LogEntry[] {
	const existing = getMemoryFile("log");
	if (!existing) return [];

	const lines = existing.content
		.split("\n")
		.filter((line) => line.startsWith("["))
		.slice(-limit);

	return lines.map((line) => {
		const match = line.match(/^\[(.+?)\] (.+?) \| (.+?) \| (.+)$/);
		if (!match) {
			return {
				timestamp: "",
				operation: "observation-created" as OperationType,
				targets: [],
				summary: line,
			};
		}
		return {
			timestamp: match[1],
			operation: match[2] as OperationType,
			targets: match[3].split(",").map((t) => t.trim()),
			summary: match[4],
		};
	});
}

/**
 * Get the full log content as a string.
 */
export function getLogContent(): string {
	const existing = getMemoryFile("log");
	return (
		existing?.content ??
		"No operation log found. Run a memory operation to start logging."
	);
}
