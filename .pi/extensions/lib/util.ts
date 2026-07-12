/**
 * Shared Utilities — Cross-Extension Helpers
 *
 * Consolidates patterns duplicated across extensions:
 *   - isAbortError (shared by deepseek/retry.ts)
 */

/**
 * Detect abort errors across different runtime shapes.
 * Covers DOMException (AbortError), Node error codes (ABORT_ERR),
 * and TimeoutError from various libraries.
 */
export function isAbortError(err: unknown): boolean {
	if (!err || typeof err !== "object") return false;
	const candidate = err as { name?: string; code?: string } | undefined;
	return (
		candidate?.name === "AbortError" ||
		candidate?.code === "ABORT_ERR" ||
		candidate?.name === "TimeoutError"
	);
}
