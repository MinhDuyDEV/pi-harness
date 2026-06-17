/** Blank lines prepended above the SDK working loader row (⠙ Working...). */
export function workingStatusSpacerLines(paddingTop: number): string[] {
  const n = Math.max(0, Math.min(8, Math.floor(paddingTop)));
  return n > 0 ? Array.from({ length: n }, () => "") : [];
}

/**
 * Prefix the default working message so the Loader Text component renders extra top rows.
 * Pass undefined to restore SDK default.
 */
export function formatWorkingMessageWithPaddingTop(
  paddingTop: number,
  baseMessage = "Working...",
): string | undefined {
  const n = Math.max(0, Math.min(8, Math.floor(paddingTop)));
  if (n <= 0) return undefined;
  return "\n".repeat(n) + baseMessage;
}

export function readWorkingPaddingTop(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(8, Math.floor(value)));
}