/**
 * Xiaomi MiMo Provider Extension for pi-harness
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
import { readExtensionGate } from "./lib/harness-settings.js";

const MIMO_BASE_URL = "https://api.xiaomimimo.com/v1";

// MiMo only supports: "low", "medium", "high" reasoning effort.
// No "max" level. xhigh is not supported (null = no effort sent).
const THINKING_LEVEL_MAP = {
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
} as const;

const MIMO_MODELS = [
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
    input: ["text", "image"] as ("text" | "image")[],
    cost: {
      input: 0.14,
      output: 0.28,
      cacheRead: 0.0028,
      cacheWrite: 0,
    },
    contextWindow: 262_144,  // effective (1M advertised; reliable within 256K via Hybrid SWA)
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
    input: ["text"] as ("text" | "image")[],
    cost: {
      input: 0.435,
      output: 0.87,
      cacheRead: 0.0036,
      cacheWrite: 0,
    },
    contextWindow: 262_144,  // effective (1M advertised; reliable within 256K via Hybrid SWA)
    maxTokens: 131_072,
  },
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
    input: ["text"] as ("text" | "image")[],
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
    input: ["text"] as ("text" | "image")[],
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
    input: ["text", "image"] as ("text" | "image")[],
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

export default function (pi: ExtensionAPI) {
  // Opt-in gate: a consumer who installs the harness should not get a
  // third-party provider registered until settings.json says so.
  if (!readExtensionGate(undefined, "mimo", false)) return;
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
