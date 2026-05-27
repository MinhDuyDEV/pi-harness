/**
 * Test suite for Dynamic Model Context Detection
 * 
 * Tests the dynamic context detection functionality to ensure it properly
 * detects model context windows and adjusts DCP limits accordingly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  detectModelContextLimits, 
  updateConfigWithContextDetection,
  DEFAULT_DYNAMIC_CONFIG,
  type DynamicContextConfig 
} from './model-context.js';
import { DEFAULT_CONFIG, type DCPConfig } from './config.js';

// Mock Model interface
interface MockModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  provider: any;
}

// Mock ExtensionContext interface
interface MockExtensionContext {
  model: MockModel | undefined;
  getContextUsage?: () => { tokens: number; percent: number } | undefined;
}

describe('Dynamic Model Context Detection', () => {
  describe('detectModelContextLimits', () => {
    it('should return fallback limits when no model is provided', () => {
      const ctx: MockExtensionContext = { model: undefined };
      const result = detectModelContextLimits(ctx as any, DEFAULT_DYNAMIC_CONFIG);
      
      expect(result.modelDetected).toBe(false);
      expect(result.maxContextLimit).toBe(DEFAULT_DYNAMIC_CONFIG.fallbackLimit);
      expect(result.minContextLimit).toBe(Math.floor(DEFAULT_DYNAMIC_CONFIG.fallbackLimit * 0.75));
    });

    it('should detect 1M context window model (MiMo/DeepSeek)', () => {
      const ctx: MockExtensionContext = {
        model: {
          id: 'XiaomiMiMo/MiMo-V2.5',
          name: 'MiMo V2.5',
          contextWindow: 1_000_000,
          maxTokens: 131_000,
          provider: {},
        },
      };
      
      const result = detectModelContextLimits(ctx as any, DEFAULT_DYNAMIC_CONFIG);
      
      expect(result.modelDetected).toBe(true);
      expect(result.modelId).toBe('XiaomiMiMo/MiMo-V2.5');
      expect(result.modelContextWindow).toBe(1_000_000);
      expect(result.maxContextLimit).toBe(800_000); // 80% of 1M
      expect(result.minContextLimit).toBe(600_000); // 75% of 800K
    });

    it('should detect 200K context window model (GPT-4)', () => {
      const ctx: MockExtensionContext = {
        model: {
          id: 'openai/gpt-4',
          name: 'GPT-4',
          contextWindow: 200_000,
          maxTokens: 32_000,
          provider: {},
        },
      };
      
      const result = detectModelContextLimits(ctx as any, DEFAULT_DYNAMIC_CONFIG);
      
      expect(result.modelDetected).toBe(true);
      expect(result.modelId).toBe('openai/gpt-4');
      expect(result.modelContextWindow).toBe(200_000);
      expect(result.maxContextLimit).toBe(160_000); // 80% of 200K
      expect(result.minContextLimit).toBe(120_000); // 75% of 160K
    });

    it('should respect minimum limit for small context models', () => {
      const ctx: MockExtensionContext = {
        model: {
          id: 'small-model',
          name: 'Small Model',
          contextWindow: 50_000, // Very small context
          maxTokens: 10_000,
          provider: {},
        },
      };
      
      const config: DynamicContextConfig = {
        ...DEFAULT_DYNAMIC_CONFIG,
        minLimit: 100_000,
      };
      
      const result = detectModelContextLimits(ctx as any, config);
      
      expect(result.modelDetected).toBe(true);
      expect(result.maxContextLimit).toBe(100_000); // Minimum limit
      expect(result.minContextLimit).toBe(100_000); // Minimum limit
    });

    it('should respect maximum limit for huge context models', () => {
      const ctx: MockExtensionContext = {
        model: {
          id: 'huge-model',
          name: 'Huge Model',
          contextWindow: 10_000_000, // 10M context
          maxTokens: 1_000_000,
          provider: {},
        },
      };
      
      const config: DynamicContextConfig = {
        ...DEFAULT_DYNAMIC_CONFIG,
        maxLimit: 2_000_000,
      };
      
      const result = detectModelContextLimits(ctx as any, config);
      
      expect(result.modelDetected).toBe(true);
      expect(result.maxContextLimit).toBe(2_000_000); // Maximum limit
      expect(result.minContextLimit).toBe(1_500_000); // 75% of 2M
    });

    it('should handle invalid context window gracefully', () => {
      const ctx: MockExtensionContext = {
        model: {
          id: 'invalid-model',
          name: 'Invalid Model',
          contextWindow: -1000, // Invalid
          maxTokens: 10_000,
          provider: {},
        },
      };
      
      const result = detectModelContextLimits(ctx as any, DEFAULT_DYNAMIC_CONFIG);
      
      expect(result.modelDetected).toBe(false);
      expect(result.maxContextLimit).toBe(DEFAULT_DYNAMIC_CONFIG.fallbackLimit);
    });

    it('should respect custom usage percentage', () => {
      const ctx: MockExtensionContext = {
        model: {
          id: 'custom-model',
          name: 'Custom Model',
          contextWindow: 1_000_000,
          maxTokens: 131_000,
          provider: {},
        },
      };
      
      const config: DynamicContextConfig = {
        ...DEFAULT_DYNAMIC_CONFIG,
        usagePercent: 60, // Use only 60% of context
      };
      
      const result = detectModelContextLimits(ctx as any, config);
      
      expect(result.maxContextLimit).toBe(600_000); // 60% of 1M
      expect(result.minContextLimit).toBe(450_000); // 75% of 600K
    });
  });

  describe('updateConfigWithContextDetection', () => {
    it('should update DCP config with detected limits', () => {
      const ctx: MockExtensionContext = {
        model: {
          id: 'XiaomiMiMo/MiMo-V2.5',
          name: 'MiMo V2.5',
          contextWindow: 1_000_000,
          maxTokens: 131_000,
          provider: {},
        },
      };
      
      const updatedConfig = updateConfigWithContextDetection(
        DEFAULT_CONFIG as DCPConfig,
        ctx as any,
        DEFAULT_DYNAMIC_CONFIG
      );
      
      expect(updatedConfig.compress.maxContextLimit).toBe(800_000);
      expect(updatedConfig.compress.minContextLimit).toBe(600_000);
    });

    it('should preserve other config properties', () => {
      const ctx: MockExtensionContext = {
        model: {
          id: 'test-model',
          name: 'Test Model',
          contextWindow: 1_000_000,
          maxTokens: 131_000,
          provider: {},
        },
      };
      
      const originalConfig = {
        ...DEFAULT_CONFIG,
        debug: true,
        compress: {
          ...DEFAULT_CONFIG.compress,
          permission: 'deny' as const,
        },
      };
      
      const updatedConfig = updateConfigWithContextDetection(
        originalConfig as DCPConfig,
        ctx as any,
        DEFAULT_DYNAMIC_CONFIG
      );
      
      expect(updatedConfig.debug).toBe(true);
      expect(updatedConfig.compress.permission).toBe('deny');
    });

    it('should use fallback limits when dynamic detection is disabled', () => {
      const ctx: MockExtensionContext = {
        model: {
          id: 'test-model',
          name: 'Test Model',
          contextWindow: 1_000_000,
          maxTokens: 131_000,
          provider: {},
        },
      };
      
      const config: DynamicContextConfig = {
        ...DEFAULT_DYNAMIC_CONFIG,
        enabled: false,
      };
      
      const updatedConfig = updateConfigWithContextDetection(
        DEFAULT_CONFIG as DCPConfig,
        ctx as any,
        config
      );
      
      expect(updatedConfig.compress.maxContextLimit).toBe(DEFAULT_CONFIG.compress.maxContextLimit);
      expect(updatedConfig.compress.minContextLimit).toBe(DEFAULT_CONFIG.compress.minContextLimit);
    });
  });

  describe('DEFAULT_DYNAMIC_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_DYNAMIC_CONFIG.enabled).toBe(true);
      expect(DEFAULT_DYNAMIC_CONFIG.fallbackLimit).toBe(200_000);
      expect(DEFAULT_DYNAMIC_CONFIG.usagePercent).toBe(80);
      expect(DEFAULT_DYNAMIC_CONFIG.minLimit).toBe(100_000);
      expect(DEFAULT_DYNAMIC_CONFIG.maxLimit).toBe(2_000_000);
    });
  });
});