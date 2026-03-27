/**
 * DCP Extension — Shared Utilities
 */

/**
 * Simple hash for tool parameter dedup tracking.
 * Deterministic for same object shape (sorts keys).
 */
export function hashParams(params: unknown): string {
	try {
		if (!params || typeof params !== "object") return "";
		const sorted = JSON.stringify(
			params,
			Object.keys(params as Record<string, unknown>).sort(),
		);
		let hash = 5381;
		for (let i = 0; i < sorted.length; i++) {
			hash = (hash * 33) ^ sorted.charCodeAt(i);
		}
		return (hash >>> 0).toString(36);
	} catch {
		return "";
	}
}

/**
 * Rough token estimation: ~4 chars per token.
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}
