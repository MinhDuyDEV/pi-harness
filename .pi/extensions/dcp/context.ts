import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

/**
 * Get the current Pi session identifier for DCP persistence.
 *
 * Pi exposes a stable session ID via `ctx.sessionManager.getSessionId()`.
 * We use that directly instead of deriving IDs from session file paths.
 */
export function getSessionId(ctx: Pick<ExtensionContext, "sessionManager">): string {
	return ctx.sessionManager.getSessionId();
}
