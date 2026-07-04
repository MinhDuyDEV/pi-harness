/** Blank lines prepended above the SDK working loader row (spinner + quote). */
export function workingStatusSpacerLines(paddingTop: number): string[] {
  const n = Math.max(0, Math.min(8, Math.floor(paddingTop)));
  return n > 0 ? Array.from({ length: n }, () => "") : [];
}

/**
 * Pool of short, friendly status messages shown next to the spinner while the
 * agent is working. One is picked at random per `agent_start` so consecutive
 * turns feel distinct (Claude Code style).
 */
export const WORKING_QUOTES: readonly string[] = [
  "Pondering...",
  "Brewing thoughts...",
  "Crunching tokens...",
  "Cooking up an answer...",
  "Reading the matrix...",
  "Paging the silicon...",
  "Drafting...",
  "Connecting neurons...",
  "Synthesizing...",
  "Working it out...",
  "Considering options...",
  "Parsing intent...",
  "Loading wisdom...",
  "Engaging...",
  "Compiling thoughts...",
];

/** Pick a uniformly random quote from `WORKING_QUOTES`. */
export function pickRandomWorkingQuote(): string {
  return WORKING_QUOTES[Math.floor(Math.random() * WORKING_QUOTES.length)]!;
}

/**
 * Prefix the working message so the Loader Text component renders extra top rows.
 * Defaults to a random quote; pass an explicit `baseMessage` to override
 * (e.g. for tests). Returns `undefined` when no padding is needed, signalling
 * the caller to restore the SDK default.
 */
export function formatWorkingMessageWithPaddingTop(
  paddingTop: number,
  baseMessage: string = pickRandomWorkingQuote(),
): string | undefined {
  const n = Math.max(0, Math.min(8, Math.floor(paddingTop)));
  if (n <= 0) return undefined;
  return "\n".repeat(n) + baseMessage;
}

export function readWorkingPaddingTop(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(8, Math.floor(value)));
}

