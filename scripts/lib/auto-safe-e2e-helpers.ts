/**
 * Auto-safe E2E synchronization helpers.
 *
 * pi-learning 0.4 stopped mutating the context-request payload with a response
 * promise and instead announces the project binding on the v1 context-served
 * signal, and the bounded learning context on the v2 context-served event.
 * These helpers await those events (matched by correlation id) so the E2E
 * orders the proof after the binding and reads the same response a real
 * consumer retrieves. Kept here so the E2E script stays under the quality
 * ratchet's file-size limit.
 */
import { parseContextServed, type LearningContextV1 } from "@minhduydev/pi-core";

const CONTEXT_SERVED_V1 = "pi-learning:v1:context-served";
const CONTEXT_SERVED_V2 = "pi-learning:v2:context-served";

export interface AutoSafeEventSink {
  on(channel: string, handler: (payload: unknown) => void): () => void;
}

function matchCorrelation(payload: unknown, correlationId: string): boolean {
  return (payload as { correlationId?: string } | null)?.correlationId === correlationId;
}

/**
 * Await the v1 binding signal for a request before proceeding. An untrusted
 * project never serves, so race a short timeout instead of hanging — the
 * caller then correctly finds no binding.
 */
export function waitForBinding(
  events: AutoSafeEventSink,
  correlationId: string,
  timeoutMs = 2_000,
): Promise<void> {
  return Promise.race([
    new Promise<void>((resolve) => {
      const off = events.on(CONTEXT_SERVED_V1, (payload) => {
        if (matchCorrelation(payload, correlationId)) {
          off();
          resolve();
        }
      });
    }),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Await the v2 context-served event and return its parsed learning context.
 */
export async function learningContextResponse(
  events: AutoSafeEventSink,
  correlationId: string,
  timeoutMs = 2_000,
): Promise<LearningContextV1 | undefined> {
  const payload = await Promise.race([
    new Promise<unknown>((resolve) => {
      const off = events.on(CONTEXT_SERVED_V2, (event) => {
        if (matchCorrelation(event, correlationId)) {
          off();
          resolve(event);
        }
      });
    }),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
  ]);
  return parseContextServed(payload)?.context;
}