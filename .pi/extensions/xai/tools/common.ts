import { resolveXaiAuthToken } from "../auth";

/** Build a simple user text input array for xAI Responses requests. */
export function xaiTextInput(text: string): Array<{ role: "user"; content: string }> {
	return [{ role: "user", content: text }];
}

/** Return a pi tool error result with optional structured details. */
export function xaiToolError(message: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text: message }], details };
}

/** Resolve an xAI token or return a structured tool error. */
export async function requireXaiAuthToken(
	ctx: unknown,
	details: Record<string, unknown> = {},
): Promise<string | ReturnType<typeof xaiToolError>> {
	const apiKey = await resolveXaiAuthToken(ctx as never);
	if (!apiKey) {
		return xaiToolError(
			"Error: No xAI OAuth credentials found. Please run the OAuth login first.",
			details,
		);
	}
	return apiKey;
}
