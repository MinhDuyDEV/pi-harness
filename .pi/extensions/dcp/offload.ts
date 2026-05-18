/**
 * DCP Tool Output Offloading — Symbolic Memory for Large Tool Results
 *
 * Inspired by TencentDB-Agent-Memory's short-term context offloading:
 * replaces verbose tool outputs inline with short reference markers,
 * storing full content in `refs/{tool_call_id}.md` files.
 *
 * This is the single biggest token saver (~60% reduction claimed).
 * Typical targets: webclaw output, large search results, long file reads.
 *
 * Design:
 *   - Threshold-based: only offload tool results above `minTokens`
 *   - Content stored in `~/.config/pi/dcp/refs/{sessionId}/{toolCallId}.md`
 *   - Inline replacement: short marker `[offloaded to refs/{toolCallId}.md]`
 *   - Recovery: agent can read the ref file when it needs the detail
 *   - LRU-capped: keeps only the most recent N refs per session
 *
 * Integration:
 *   Called from the `context` event in dcp.ts, post strategy pipeline.
 *   Operates on the already-filtered message array — safe to mutate.
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DCPConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REFS_DIR = join(homedir(), ".config", "pi", "dcp", "refs");

/** Default minimum token threshold before offloading (matches a ~2KB text result) */
const DEFAULT_MIN_TOKENS = 1000;

/** Max ref files to keep per session (oldest purged) */
const MAX_REFS_PER_SESSION = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OffloadResult {
	offloadedCount: number;
	savedTokens: number;
	refs: string[];
}

export interface OffloadConfig {
	/** Minimum token count to trigger offloading (0 = disabled) */
	minTokens: number;
	/** Maximum number of refs to keep per session */
	maxRefsPerSession: number;
	/** Tools whose results should NOT be offloaded (e.g., compact tools) */
	protectedTools: string[];
}

// ---------------------------------------------------------------------------
// Offload Engine
// ---------------------------------------------------------------------------

/**
 * Offload large text content from tool results to ref files.
 * Mutates the messages array in-place (replaces large text with markers).
 *
 * @param messages - Array of AgentMessage (from context event, already filtered)
 * @param sessionId - Current session ID for file scoping
 * @param config - Offload configuration (or defaults)
 * @returns Statistics about what was offloaded
 */
export function offloadLargeToolResults(
	messages: unknown[],
	sessionId: string,
	config: OffloadConfig = {
		minTokens: DEFAULT_MIN_TOKENS,
		maxRefsPerSession: MAX_REFS_PER_SESSION,
		protectedTools: [],
	},
): OffloadResult {
	if (!config.minTokens || config.minTokens <= 0) {
		return { offloadedCount: 0, savedTokens: 0, refs: [] };
	}

	const sessionRefsDir = join(REFS_DIR, sanitizeSessionId(sessionId));
	ensureDir(sessionRefsDir);

	const protectedSet = new Set(config.protectedTools);
	const refs: string[] = [];
	let offloadedCount = 0;
	let savedTokens = 0;

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i] as Record<string, unknown>;
		if (!msg || msg.role !== "toolResult") continue;

		const tr = msg as {
			role: string;
			toolCallId?: string;
			toolName?: string;
			isError?: boolean;
			content?: Array<{ type: string; text?: string }>;
		};

		if (!tr.toolCallId || !tr.toolName) continue;
		if (protectedSet.has(tr.toolName)) continue;
		if (tr.isError) continue;
		if (!Array.isArray(tr.content)) continue;

		let totalTokens = 0;
		const contentIndices: number[] = [];

		// Find text content blocks and estimate tokens
		for (let ci = 0; ci < tr.content.length; ci++) {
			const part = tr.content[ci];
			if (part?.type === "text" && typeof part.text === "string") {
				const tokens = estimateTokens(part.text);
				totalTokens += tokens;
				if (tokens >= config.minTokens) {
					contentIndices.push(ci);
				}
			}
		}

		if (contentIndices.length === 0) continue;

		// Build the ref file content: all text parts concatenated
		const refContent = contentIndices
			.map((ci) => tr.content![ci].text ?? "")
			.join("\n\n---\n\n");

		// Store to ref file
		const refFileName = `${tr.toolName}-${tr.toolCallId}.md`;
		const refPath = join(sessionRefsDir, refFileName);

		try {
			writeFileSync(refPath, refContent, "utf-8");
		} catch {
			// Best-effort storage
			continue;
		}

		refs.push(refFileName);

		// Replace text content with reference markers
		for (const ci of contentIndices) {
			const originalText = tr.content[ci].text ?? "";
			const originalTokens = estimateTokens(originalText);

			tr.content[ci].text = `[offloaded to refs/${refFileName}]`;
			savedTokens += originalTokens - estimateTokens(tr.content[ci].text);
			offloadedCount++;
		}
	}

	// Enforce session ref cap (LRU: remove oldest)
	enforceRefCap(sessionRefsDir, config.maxRefsPerSession);

	return { offloadedCount, savedTokens, refs };
}

/**
 * Get the path to a ref file for reading (recovery).
 */
export function getRefPath(
	sessionId: string,
	refFileName: string,
): string | null {
	const refPath = join(
		REFS_DIR,
		sanitizeSessionId(sessionId),
		refFileName,
	);
	return existsSync(refPath) ? refPath : null;
}

/**
 * List all ref files for a session.
 */
export function listRefs(sessionId: string): string[] {
	const sessionRefsDir = join(REFS_DIR, sanitizeSessionId(sessionId));
	if (!existsSync(sessionRefsDir)) return [];
	try {
		return readdirSync(sessionRefsDir).filter((f) => f.endsWith(".md"));
	} catch {
		return [];
	}
}

/**
 * Clean up all ref files for a session.
 */
export function clearSessionRefs(sessionId: string): number {
	const sessionRefsDir = join(REFS_DIR, sanitizeSessionId(sessionId));
	if (!existsSync(sessionRefsDir)) return 0;
	let count = 0;
	try {
		const files = readdirSync(sessionRefsDir);
		for (const file of files) {
			try {
				unlinkSync(join(sessionRefsDir, file));
				count++;
			} catch {
				// best-effort
			}
		}
		// Remove empty dir
		try {
			rmdirSync(sessionRefsDir);
		} catch {
			// best-effort
		}
	} catch {
		// best-effort
	}
	return count;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estimate token count from text (4 chars per token, matches DCP estimateTokens).
 */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Ensure a directory exists.
 */
function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/**
 * Sanitize session ID for filesystem use (no path traversal, no special chars).
 */
function sanitizeSessionId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "default";
}

/**
 * Enforce maximum refs per session — purge oldest files when over cap.
 */
function enforceRefCap(dir: string, maxRefs: number): void {
	if (!existsSync(dir)) return;
	try {
		const files = readdirSync(dir)
			.filter((f) => f.endsWith(".md"))
			.map((f) => ({
				name: f,
				path: join(dir, f),
				mtimeMs: existsSync(join(dir, f)) ? require("fs").statSync(join(dir, f)).mtimeMs : 0,
			}))
			.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first

		if (files.length <= maxRefs) return;

		// Remove oldest files beyond cap
		for (const file of files.slice(maxRefs)) {
			try {
				unlinkSync(file.path);
			} catch {
				// best-effort
			}
		}
	} catch {
		// best-effort
	}
}

// Need rmdirSync from fs
const { rmdirSync } = require("node:fs");
