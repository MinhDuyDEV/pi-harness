/**
 * Enhanced fetch with retry — DeepSeek-optimized
 *
 * Stolen from Reasonix (src/retry.ts) — MIT License
 *
 * Key differences from naive retry:
 * - Drains response body before retry (prevents connection pool exhaustion)
 * - Respects Retry-After header
 * - Exponential backoff with jitter (spreads retries across clients)
 * - Separates network errors (retryable from attempt 1) from HTTP errors
 * - Never retries on abort
 */

import { isAbortError } from "../lib/util.js";

interface RetryOptions {
  /** Maximum total attempts (including the first). Default 4. */
  maxAttempts?: number;
  /** Initial backoff in ms. Doubles each retry, with jitter. Default 500. */
  initialBackoffMs?: number;
  /** Upper bound on any single backoff delay. Default 10_000 (10s). */
  maxBackoffMs?: number;
  /** HTTP statuses to treat as retryable. Default [408, 429, 500, 502, 503, 504]. */
  retryableStatuses?: readonly number[];
  /** Abort signal; we do NOT retry once aborted. */
  signal?: AbortSignal;
  /** Telemetry hook — called before each wait. */
  onRetry?: (info: RetryInfo) => void;
}

interface RetryInfo {
  attempt: number;
  reason: string;
  waitMs: number;
}

const DEFAULT_RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504] as const;

/**
 * Fetch with exponential backoff, jitter, Retry-After support, and body draining.
 */
export async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  opts: RetryOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const initial = opts.initialBackoffMs ?? 500;
  const cap = opts.maxBackoffMs ?? 10_000;
  const retryable = new Set(opts.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES);

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    try {
      const resp = await fetchFn(url, init);

      // Success or non-retryable failure: return as-is
      if (resp.ok || !retryable.has(resp.status)) return resp;

      // Retryable but out of attempts: return the last response so the caller
      // can surface the status to the user
      if (attempt === maxAttempts - 1) return resp;

      // Drain the body so the connection can be reused on the next attempt
      // This is critical — without it, HTTP/1.1 connections can't be pooled
      await resp.text().catch(() => undefined);

      const waitMs = computeWait(attempt, initial, cap, resp.headers.get("Retry-After"));
      opts.onRetry?.({ attempt: attempt + 1, reason: `http ${resp.status}`, waitMs });
      await sleep(waitMs, opts.signal);
    } catch (err) {
      lastError = err;

      // Respect explicit aborts — do not retry
      if (isAbortError(err) || opts.signal?.aborted) throw err;

      if (attempt === maxAttempts - 1) throw err;

      const waitMs = computeWait(attempt, initial, cap, null);
      opts.onRetry?.({
        attempt: attempt + 1,
        reason: `network: ${messageOf(err)}`,
        waitMs,
      });
      await sleep(waitMs, opts.signal);
    }
  }

  throw lastError ?? new Error("fetchWithRetry: loop exited unexpectedly");
}

/**
 * Compute backoff with:
 * - Retry-After header support (server's explicit instruction)
 * - Exponential backoff: initial * 2^attempt
 * - Jitter: [75%, 125%] range to spread retries across clients
 * - Cap: maxBackoffMs
 */
function computeWait(
  attempt: number,
  initial: number,
  cap: number,
  retryAfter: string | null,
): number {
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, cap);
    }
  }

  const exp = initial * Math.pow(2, attempt);
  // Jitter range [75%, 125%]
  const jitter = exp * (0.75 + Math.random() * 0.5);
  return Math.min(Math.max(jitter, 0), cap);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return "unknown error";
  }
}
