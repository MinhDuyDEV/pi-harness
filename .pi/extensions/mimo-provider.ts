/**
 * Xiaomi MiMo Provider Extension for pikit
 *
 * Lightweight provider that registers MiMo models via Pi's built-in
 * openai-completions handler. MiMo is a clean OpenAI-compatible API
 * so no custom streamSimple is needed — unlike the DeepSeek provider
 * which requires repair pipeline and storm breaker.
 *
 * Pricing source: https://platform.xiaomimimo.com/docs/en-US/news/v2.5-price-update
 * API docs: https://platform.xiaomimimo.com/docs/en-US/development/api-reference/chatopenai-api
 *
 * Usage:
 *   1. Place mimo-provider.ts in .pi/extensions/
 *   2. Set XIAOMI_MIMO_API_KEY in environment
 *   3. Select any mimo model via `/model` in Pi
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ─── Constants ──────────────────────────────────────────────

const MIMO_BASE_URL = "https://api.xiaomimimo.com/v1";
const MIMO_API_KEY_ENV = "XIAOMI_MIMO_API_KEY";

// ─── Model Definitions ──────────────────────────────────────
// Pricing effective May 27, 2026 (v2.5 permanent price cut, up to 99% off)
// Length-based tiers REMOVED — simplified flat pricing.
// Source: Xiaomi MiMo official announcement email (May 2026)
//         https://platform.xiaomimimo.com/docs/en-US/news/v2.5-price-update
//
// MiMo-V2.5 (Per 1M tokens):
//   Input (cache miss): $0.14/1M tokens
//   Input (cache hit):  $0.0028/1M tokens
//   Output:             $0.28/1M tokens
//
// MiMo-V2.5-Pro (Per 1M tokens):
//   Input (cache miss): $0.435/1M tokens
//   Input (cache hit):  $0.0036/1M tokens
//   Output:             $0.87/1M tokens
//
// MiMo-V2.5-TTS: Free (limited time)
// V2 models: pricing unchanged, will be deprecated soon

// ─── Thinking level map ─────────────────────────────────────

// MiMo only supports: "low", "medium", "high" reasoning effort.
// No "max" level. xhigh is not supported (null = no effort sent).
const THINKING_LEVEL_MAP = {
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
} as const;

// ─── Models ─────────────────────────────────────────────────

const MIMO_MODELS = [
  // --- V2.5 series (latest, best pricing, released Apr 23 2026) ---
  {
    id: "xiaomi/mimo-v2.5",
    name: "MiMo V2.5",
    api: "openai-completions" as const,
    provider: "xiaomi-mimo",
    baseUrl: MIMO_BASE_URL,
    reasoning: true,
    thinkingLevelMap: THINKING_LEVEL_MAP,
    compat: {
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek" as const,
    },
    input: ["text", "image"] as const,
    cost: {
      input: 0.14,
      output: 0.28,
      cacheRead: 0.0028,
      cacheWrite: 0,
    },
    contextWindow: 200_000,  // effective (1M advertised; see header comment)
    maxTokens: 131_072,
  },
  {
    id: "xiaomi/mimo-v2.5-pro",
    name: "MiMo V2.5 Pro",
    api: "openai-completions" as const,
    provider: "xiaomi-mimo",
    baseUrl: MIMO_BASE_URL,
    reasoning: true,
    thinkingLevelMap: THINKING_LEVEL_MAP,
    compat: {
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek" as const,
    },
    input: ["text"] as const,
    cost: {
      input: 0.435,
      output: 0.87,
      cacheRead: 0.0036,
      cacheWrite: 0,
    },
    contextWindow: 200_000,  // effective (1M advertised; see header comment)
    maxTokens: 131_072,
  },
  // --- V2 series (previous gen) ---
  {
    id: "xiaomi/mimo-v2-flash",
    name: "MiMo V2 Flash",
    api: "openai-completions" as const,
    provider: "xiaomi-mimo",
    baseUrl: MIMO_BASE_URL,
    reasoning: true,
    thinkingLevelMap: THINKING_LEVEL_MAP,
    compat: {
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek" as const,
    },
    input: ["text"] as const,
    cost: {
      input: 0.1,
      output: 0.3,
      cacheRead: 0.01,
      cacheWrite: 0,
    },
    contextWindow: 262_144,
    maxTokens: 65_536,
  },
  {
    id: "xiaomi/mimo-v2-pro",
    name: "MiMo V2 Pro",
    api: "openai-completions" as const,
    provider: "xiaomi-mimo",
    baseUrl: MIMO_BASE_URL,
    reasoning: true,
    thinkingLevelMap: THINKING_LEVEL_MAP,
    compat: {
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek" as const,
    },
    input: ["text"] as const,
    cost: {
      input: 1.0,
      output: 3.0,
      cacheRead: 0.2,
      cacheWrite: 0,
    },
    contextWindow: 1_048_576,
    maxTokens: 131_072,
  },
  {
    id: "xiaomi/mimo-v2-omni",
    name: "MiMo V2 Omni",
    api: "openai-completions" as const,
    provider: "xiaomi-mimo",
    baseUrl: MIMO_BASE_URL,
    reasoning: true,
    thinkingLevelMap: THINKING_LEVEL_MAP,
    compat: {
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek" as const,
    },
    input: ["text", "image"] as const,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 262_144,
    maxTokens: 131_072,
  },
];

// ─── Extension Entry ────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerProvider("xiaomi-mimo", {
    name: "Xiaomi MiMo",
    baseUrl: MIMO_BASE_URL,
    apiKey: "$XIAOMI_MIMO_API_KEY", // $ prefix tells Pi to resolve from env var
    api: "openai-completions",
    models: MIMO_MODELS,
    authHeader: true,
    // No custom streamSimple needed — Pi's built-in openai-completions
    // handler handles MiMo's clean OpenAI-compatible API directly.
  });
}
