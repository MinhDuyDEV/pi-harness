export interface UsageTokenMetrics {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface UsageSnapshot {
  lastTurn: UsageTokenMetrics;
  elapsedMs: number;
  totalCostUsd: number;
}

export interface BranchUsageEntry {
  type?: unknown;
  timestamp?: unknown;
  message?: {
    role?: unknown;
    usage?: unknown;
    timestamp?: unknown;
  };
}

export function emptyUsageTokenMetrics(): UsageTokenMetrics {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

export function addUsageTokenMetrics(a: UsageTokenMetrics, b: UsageTokenMetrics): UsageTokenMetrics {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    total: a.total + b.total,
  };
}

export function hasUsageTokenMetrics(metrics: UsageTokenMetrics): boolean {
  return metrics.input > 0 || metrics.output > 0 || metrics.cacheRead > 0 || metrics.cacheWrite > 0 || metrics.total > 0;
}

export function displayedTurnUsage(
  lastCompletedTurn: UsageTokenMetrics,
  currentCompletedTurn: UsageTokenMetrics,
  currentStreamingTurn: UsageTokenMetrics,
): UsageTokenMetrics {
  const currentTurn = addUsageTokenMetrics(currentCompletedTurn, currentStreamingTurn);
  return hasUsageTokenMetrics(currentTurn) ? currentTurn : lastCompletedTurn;
}

export function usageCostUsd(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const raw = usage as { cost?: unknown; cost_total?: unknown };
  if (typeof raw.cost === "object" && raw.cost !== null) {
    const cost = raw.cost as Record<string, unknown>;
    const total = toFiniteNumber(cost.total);
    if (total > 0) return total;
    return ["input", "output", "cacheRead", "cacheWrite"]
      .map((key) => toFiniteNumber(cost[key]))
      .reduce((sum, value) => sum + value, 0);
  }
  return toFiniteNumber(raw.cost_total ?? raw.cost);
}

export function usageTokenMetrics(usage: unknown): UsageTokenMetrics {
  if (!usage || typeof usage !== "object") {
    return emptyUsageTokenMetrics();
  }
  const raw = usage as Record<string, unknown>;
  const input = toFiniteNumber(raw.input ?? raw.input_tokens ?? raw.prompt_tokens);
  const output = toFiniteNumber(raw.output ?? raw.output_tokens ?? raw.completion_tokens);
  const cacheRead = toFiniteNumber(raw.cacheRead ?? raw.cache_read_input_tokens ?? raw.cache_read_tokens ?? raw.cache_read);
  const cacheWrite = toFiniteNumber(raw.cacheWrite ?? raw.cache_creation_input_tokens ?? raw.cache_write_tokens ?? raw.cache_write);
  const total = toFiniteNumber(raw.totalTokens ?? raw.total_tokens) || input + output;
  return { input, output, cacheRead, cacheWrite, total };
}

export function restoreUsageSnapshotFromBranch(entries: Iterable<BranchUsageEntry>): UsageSnapshot {
  // Session files store message timestamps, not exact turn durations. Restore
  // elapsed time as a best-effort delta from the previous branch entry.
  let totalCostUsd = 0;
  let lastTurn = emptyUsageTokenMetrics();
  let elapsedMs = 0;
  let previousTimestampMs: number | null = null;

  for (const entry of entries) {
    const entryTimestampMs = toTimestampMs(entry.timestamp);
    const message = entry.type === "message" ? entry.message : undefined;
    if (message?.role === "assistant" && message.usage) {
      lastTurn = usageTokenMetrics(message.usage);
      totalCostUsd += usageCostUsd(message.usage);
      const assistantTimestampMs = toTimestampMs(message.timestamp) ?? entryTimestampMs;
      if (assistantTimestampMs !== null && previousTimestampMs !== null) {
        elapsedMs = Math.max(0, assistantTimestampMs - previousTimestampMs);
      }
    }
    previousTimestampMs = entryTimestampMs ?? previousTimestampMs;
  }

  return { lastTurn, elapsedMs, totalCostUsd };
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
