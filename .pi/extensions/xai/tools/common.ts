/** Build a simple user text input array for xAI Responses requests. */
export function xaiTextInput(text: string): Array<{ role: "user"; content: string }> {
  return [{ role: "user", content: text }];
}

/** Return a pi tool error result with optional structured details. */
export function xaiToolError(message: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text", text: message }], details };
}
