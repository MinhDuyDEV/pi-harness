import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

interface EventWithSessionId {
	sessionId?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * Get the current Pi session identifier for persistence.
 *
 * Prefer the runtime session manager when available, but tolerate partial event
 * payloads during extension hooks so non-DCP extensions can share the helper.
 */
export function getSessionId(
	ctx?: Pick<ExtensionContext, "sessionManager"> | null,
	event?: EventWithSessionId | null,
): string {
	const manager = ctx?.sessionManager as { getSessionId?: () => string } | undefined;
	if (manager?.getSessionId) {
		const sessionId = manager.getSessionId();
		if (isNonEmptyString(sessionId)) return sessionId;
	}

	if (isNonEmptyString(event?.sessionId)) return event.sessionId.trim();
	return "default";
}
