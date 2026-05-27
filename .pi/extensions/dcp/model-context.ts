/**
 * Dynamic Model Context Detection
 * 
 * Automatically detects the current model's context window and adjusts
 * DCP compression limits accordingly. This ensures optimal utilization
 * of large context models like MiMo (1M) and DeepSeek (1M).
 */

import type { DCPConfig, DynamicContextConfig } from "./config.js";

/**
 * Model interface matching pi-ai's Model type
 */
interface Model {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  provider: any;
  [key: string]: any;
}

/**
 * ExtensionContext interface matching pi-coding-agent's ExtensionContext
 */
interface ExtensionContext {
  model: Model | undefined;
  [key: string]: any;
}

/**
 * Default dynamic context configuration
 */
export const DEFAULT_DYNAMIC_CONFIG: DynamicContextConfig = {
  enabled: true,
  fallbackLimit: 200_000,  // 200K fallback for unknown models
  usagePercent: 80,        // Use 80% of context window
  minLimit: 100_000,       // Minimum 100K tokens
  maxLimit: 2_000_000,     // Maximum 2M tokens (safety cap)
};

/**
 * Detect model context window and calculate optimal DCP limits
 * 
 * @param ctx - Extension context with model information
 * @param config - Dynamic context configuration
 * @returns Calculated limits for DCP compression
 */
export function detectModelContextLimits(
  ctx: ExtensionContext | undefined,
  config: DynamicContextConfig = DEFAULT_DYNAMIC_CONFIG
): {
  maxContextLimit: number;
  minContextLimit: number;
  modelDetected: boolean;
  modelId: string | undefined;
  modelContextWindow: number | undefined;
} {
  // Default result with fallback values
  const result = {
    maxContextLimit: config.fallbackLimit,
    minContextLimit: Math.floor(config.fallbackLimit * 0.75),  // 75% of max
    modelDetected: false,
    modelId: undefined as string | undefined,
    modelContextWindow: undefined as number | undefined,
  };

  if (!config.enabled || !ctx?.model) {
    return result;
  }

  const model = ctx.model;
  result.modelId = model.id;
  result.modelContextWindow = model.contextWindow;

  // Validate context window
  if (typeof model.contextWindow !== 'number' || model.contextWindow <= 0) {
    console.log(`[dcp] Invalid context window for model ${model.id}: ${model.contextWindow}`);
    return result;
  }

  // Calculate limits based on model's context window
  const effectiveContextWindow = Math.min(
    Math.max(model.contextWindow, config.minLimit),
    config.maxLimit
  );

  const calculatedMax = Math.floor(effectiveContextWindow * (config.usagePercent / 100));
  const calculatedMin = Math.floor(calculatedMax * 0.75);  // 75% of max for minimum

  result.maxContextLimit = Math.max(calculatedMax, config.minLimit);
  result.minContextLimit = Math.max(calculatedMin, config.minLimit);
  result.modelDetected = true;

  console.log(`[dcp] Detected model: ${model.id}`);
  console.log(`[dcp] Model context window: ${model.contextWindow.toLocaleString()} tokens`);
  console.log(`[dcp] Calculated DCP limits: max=${result.maxContextLimit.toLocaleString()}, min=${result.minContextLimit.toLocaleString()}`);

  return result;
}

/**
 * Update DCP config with dynamically detected limits
 * 
 * @param config - DCP configuration to update
 * @param ctx - Extension context with model information
 * @param dynamicConfig - Dynamic context detection configuration
 * @returns Updated DCP config with new limits
 */
export function updateConfigWithContextDetection(
  config: DCPConfig,
  ctx: ExtensionContext | undefined,
  dynamicConfig: DynamicContextConfig = DEFAULT_DYNAMIC_CONFIG
): DCPConfig {
  const limits = detectModelContextLimits(ctx, dynamicConfig);
  
  // Create updated config
  const updatedConfig = { ...config };
  updatedConfig.compress = {
    ...config.compress,
    maxContextLimit: limits.maxContextLimit,
    minContextLimit: limits.minContextLimit,
  };

  // Log the update
  if (limits.modelDetected) {
    console.log(`[dcp] Updated compression limits for model ${limits.modelId}:`);
    console.log(`  - maxContextLimit: ${limits.maxContextLimit.toLocaleString()} tokens`);
    console.log(`  - minContextLimit: ${limits.minContextLimit.toLocaleString()} tokens`);
  } else {
    console.log(`[dcp] Using fallback limits (no model detected):`);
    console.log(`  - maxContextLimit: ${limits.maxContextLimit.toLocaleString()} tokens`);
    console.log(`  - minContextLimit: ${limits.minContextLimit.toLocaleString()} tokens`);
  }

  return updatedConfig;
}

/**
 * Get context usage statistics for monitoring
 * 
 * @param ctx - Extension context
 * @returns Context usage information
 */
export function getContextUsageStats(ctx: ExtensionContext | undefined): {
  modelId: string | undefined;
  modelContextWindow: number | undefined;
  currentUsage: number | undefined;
  usagePercent: number | undefined;
} {
  if (!ctx?.model) {
    return {
      modelId: undefined,
      modelContextWindow: undefined,
      currentUsage: undefined,
      usagePercent: undefined,
    };
  }

  const contextUsage = ctx.getContextUsage?.();
  
  return {
    modelId: ctx.model.id,
    modelContextWindow: ctx.model.contextWindow,
    currentUsage: contextUsage?.tokens,
    usagePercent: contextUsage?.percent,
  };
}