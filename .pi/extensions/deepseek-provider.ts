/**
 * DeepSeek Provider Extension for pi-harness
 *
 * A Pi custom provider that brings all Reasonix learnings:
 * - Thinking mode (reasoning_content) support for V4 Pro/Flash
 * - Cache-friendly message assembly and healing
 * - Tool-call repair pipeline (truncation, pairing, schema sanitization)
 * - DSML hallucination stripping
 * - Storm breaker (repeat-loop detection)
 * - Retry with exponential backoff and body draining
 * - Token-aware message shrinking
 *
 * Uses streamSimple registered via pi.registerProvider() — Pi internally
 * registers this as the handler for the "deepseek" API type.
 *
 * P0-P3 from the Reasonix audit, implemented as one extension.
 *
 * Usage:
 *   1. Place deepseek-provider.ts and deepseek/ directory in .pi/extensions/
 *   2. Set DEEPSEEK_API_KEY in environment
 *   3. Select any deepseek model via `/model` in Pi
 */

import type { ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { DEEPSEEK_BASE_URL, deepseekStreamSimple } from "./deepseek/stream.js";
import { readExtensionGate } from "./lib/harness-settings.js";

// Official pricing as of 2026-05-26: https://api-docs.deepseek.com/quick_start/pricing
//
// deepseek-v4-flash:
//   Input (cache miss): $0.14/1M tokens
//   Input (cache hit):  $0.0028/1M tokens
//   Output:             $0.28/1M tokens
//   Context: 1M, Max output: 384K
//
// deepseek-v4-pro (current promotional pricing, 75% off until 2026-05-31):
//   Input (cache miss): $0.435/1M tokens  (permanent after promo: 1/4 of $1.74 = $0.435)
//   Input (cache hit):  $0.003625/1M tokens (permanent after promo: 1/4 of $0.0145 = $0.003625)
//   Output:             $0.87/1M tokens   (permanent after promo: 1/4 of $3.48 = $0.87)
//   Context: 1M, Max output: 384K
//
// deepseek-v4-flash-nonthinking is V4 Flash with thinking disabled (~2-3x cheaper output,
// no reasoning trace). deepseek-v4-flash auto-detects thinking mode.

// Effective reliable context window.
// DeepSeek V4 advertises 1M, but MRCR 8-needle retrieval accuracy stays
// above 0.82 through 256K, then drops to 0.59 at 1M (source: DeepSeek V4
// technical report, Figure 9 — huggingface.co/blog/deepseekv4).
// For agentic coding where retrieval precision matters, 256K is the
// practical sweet spot. DCP uses this for nudge threshold calculations.
const CTX_EFFECTIVE = 262_144; // 256K
const MAX_OUT_384K = 393_216;

const PER_TOKEN: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  v4flash: {
    input: 0.14 / 1_000_000,
    output: 0.28 / 1_000_000,
    cacheRead: 0.0028 / 1_000_000,
    cacheWrite: 0.14 / 1_000_000,
  },
  v4pro: {
    input: 0.435 / 1_000_000,
    output: 0.87 / 1_000_000,
    cacheRead: 0.003625 / 1_000_000,
    cacheWrite: 0.435 / 1_000_000,
  },
} as const;

const DEEPSEEK_MODELS: ProviderModelConfig[] = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    reasoning: true,
    thinkingLevelMap: {
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: "max",
    },
    input: ["text"] as const,
    cost: PER_TOKEN.v4flash,
    contextWindow: CTX_EFFECTIVE,
    maxTokens: MAX_OUT_384K,
  },
  {
    id: "deepseek-chat",
    name: "DeepSeek V4 Flash (Non-Thinking)",
    reasoning: false,
    input: ["text"] as const,
    cost: PER_TOKEN.v4flash,
    contextWindow: CTX_EFFECTIVE,
    maxTokens: MAX_OUT_384K,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    reasoning: true,
    thinkingLevelMap: {
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: "max",
    },
    input: ["text"] as const,
    cost: PER_TOKEN.v4pro,
    contextWindow: CTX_EFFECTIVE,
    maxTokens: MAX_OUT_384K,
  },
];

export interface DeepseekProviderApi {
  registerProvider(name: string, config: ProviderConfig): void;
}

export default function (pi: DeepseekProviderApi) {
  // Opt-in gate: a consumer who installs the harness should not get a
  // third-party provider registered until settings.json says so.
  if (!readExtensionGate(undefined, "deepseek", false)) return;
  pi.registerProvider("deepseek", {
    name: "DeepSeek",
    baseUrl: DEEPSEEK_BASE_URL,
    apiKey: "$DEEPSEEK_API_KEY", // $ prefix tells Pi to resolve from env var DEEPSEEK_API_KEY
    api: "deepseek",
    models: DEEPSEEK_MODELS,
    authHeader: true,
    streamSimple: deepseekStreamSimple,
  });
}
