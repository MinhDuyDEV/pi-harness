/**
 * DCP Extension — Deferred Drop Queue (v2)
 *
 * Implements Magic Context's cache-aware deferred drop system.
 * Instead of applying message drops immediately, they're queued
 * until the provider's KV cache TTL expires — avoiding re-processing cost.
 *
 * Drops execute when:
 *   (a) Cache TTL has expired (execute_after timestamp passed), OR
 *   (b) Context usage exceeds executeThresholdPercent (forced execution)
 */

import type { DCPConfig } from "./config.js";
import {
	enqueueDrop,
	getPendingDrops,
	getExecutableDrops,
	markDropExecuted,
	markAllDropsExecuted,
	type DropQueueEntry,
} from "./db.js";

// ---------------------------------------------------------------------------
// Drop Queue Manager
// ---------------------------------------------------------------------------

export class DropQueue {
	private sessionId: string;
	private config: DCPConfig;

	constructor(sessionId: string, config: DCPConfig) {
		this.sessionId = sessionId;
		this.config = config;
	}

	/**
	 * Queue a set of tag IDs for deferred dropping.
	 *
	 * @param tagIds - Tag IDs to drop
	 * @param reason - Human-readable reason for the drop
	 * @param modelName - Current model name (for per-model TTL lookup)
	 * @returns Queue entry ID
	 */
	enqueue(tagIds: number[], reason: string, modelName?: string): number {
		if (!this.config.dropQueue.enabled || tagIds.length === 0) return -1;

		const ttlMs = this.getCacheTTL(modelName);
		return enqueueDrop(this.sessionId, tagIds, reason, ttlMs);
	}

	/**
	 * Get drops that are ready to execute (TTL expired).
	 * If forceAll is true, return all pending drops regardless of TTL
	 * (used when context hits executeThresholdPercent).
	 */
	getExecutable(forceAll: boolean = false): DropQueueEntry[] {
		if (!this.config.dropQueue.enabled) return [];
		return getExecutableDrops(this.sessionId, forceAll);
	}

	/**
	 * Process the drop queue against a message array.
	 * Returns the set of tag IDs that should be stripped from context.
	 *
	 * @param contextPercent - Current context usage percentage (null if unknown)
	 * @returns Set of tag_ids whose content should be stripped
	 */
	processQueue(contextPercent: number | null): Set<number> {
		if (!this.config.dropQueue.enabled) return new Set();

		// Determine if we should force-execute all pending drops
		const forceAll = contextPercent !== null &&
			contextPercent >= this.config.dropQueue.executeThresholdPercent;

		const executable = this.getExecutable(forceAll);
		const tagIdsToStrip = new Set<number>();

		for (const entry of executable) {
			try {
				const tags: number[] = JSON.parse(entry.tag_ranges);
				for (const tagId of tags) {
					// Respect protected tags — last N tags are immune
					// (We check this in the caller since we need the current max tag)
					tagIdsToStrip.add(tagId);
				}
				markDropExecuted(entry.id);
			} catch {
				// Malformed entry — mark as executed to skip it
				markDropExecuted(entry.id);
			}
		}

		return tagIdsToStrip;
	}

	/**
	 * Get the number of pending (not yet executed) drops.
	 */
	getPendingCount(): number {
		if (!this.config.dropQueue.enabled) return 0;
		return getPendingDrops(this.sessionId).length;
	}

	/**
	 * Get all pending drops for display.
	 */
	getPending(): DropQueueEntry[] {
		if (!this.config.dropQueue.enabled) return [];
		return getPendingDrops(this.sessionId);
	}

	/**
	 * Force-execute all pending drops (e.g. on compaction).
	 */
	flushAll(): void {
		markAllDropsExecuted(this.sessionId);
	}

	/**
	 * Reset the queue (e.g. after compaction).
	 */
	reset(): void {
		this.flushAll();
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	private getCacheTTL(modelName?: string): number {
		if (!modelName) return this.config.dropQueue.cacheTTL.defaultMs;

		// Check per-model overrides
		for (const [pattern, ttl] of Object.entries(this.config.dropQueue.cacheTTL.perModel)) {
			if (modelName.includes(pattern)) return ttl;
		}

		return this.config.dropQueue.cacheTTL.defaultMs;
	}
}
