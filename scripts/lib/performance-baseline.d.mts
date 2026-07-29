export interface DurationSummary {
  unit: "ms";
  samples: number;
  min: number;
  median: number;
  max: number;
}

export interface ContextFootprint {
  unit: "bytes";
  bytes: number;
  characters: number;
  estimatedTokens: number;
  tokenEstimateMethod: string;
}

export interface PerformanceBaselineInput {
  startupDurationsMs: number[];
  contextParts: string[];
  pollingDurationsMs: number[];
  pollingIterations: number;
  resourceCounts: Record<string, number>;
  environment: Record<string, string | number>;
}

export interface PerformanceBaseline {
  schemaVersion: 1;
  recordedAt: string;
  environment: Record<string, string | number>;
  measurements: {
    startup: DurationSummary & { operation: string; resourceCounts: Record<string, number> };
    context: ContextFootprint & { operation: string };
    polling: DurationSummary & { operation: string; iterations: number };
  };
  limitations: string[];
}

export function summarizeDurations(values: number[]): DurationSummary;
export function contextFootprint(parts: string[]): ContextFootprint;
export function buildPerformanceBaseline(input: PerformanceBaselineInput): PerformanceBaseline;
