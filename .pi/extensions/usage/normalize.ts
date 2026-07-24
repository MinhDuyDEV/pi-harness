export interface NormalizedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  thinking: number;
  cost: number;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function formatCost(usd: number): string {
  if (usd === 0) return "free";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function extractProvider(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.slice(0, slash) : "unknown";
}

export function extractModel(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.slice(slash + 1) : modelId;
}

export function normalizeUsage(raw: unknown): NormalizedUsage | null {
  const value = toRecord(raw);
  if (!value) return null;
  const cost = toRecord(value.cost);
  const usage = {
    input: toNumber(value.input ?? value.input_tokens ?? value.prompt_tokens),
    output: toNumber(value.output ?? value.output_tokens ?? value.completion_tokens),
    cacheRead: toNumber(value.cacheRead ?? value.cache_read_input_tokens ?? value.cache_read_tokens ?? value.cache_read),
    cacheWrite: toNumber(value.cacheWrite ?? value.cache_creation_input_tokens ?? value.cache_write_tokens ?? value.cache_write),
    thinking: toNumber(value.thinking ?? value.thinking_tokens ?? value.reasoning),
    cost: toNumber(cost?.total ?? value.cost_total ?? value.cost),
  };
  return Object.values(usage).every((amount) => amount === 0) ? null : usage;
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed ? Math.max(1, Math.ceil(trimmed.length / 4)) : 0;
}

export function fallbackUsageFromMessage(message: unknown, lastInputEstimate: number): NormalizedUsage | null {
  const output = estimateTokens(extractAssistantText(message));
  const input = Math.max(0, lastInputEstimate);
  return input === 0 && output === 0
    ? null
    : { input, output, cacheRead: 0, cacheWrite: 0, thinking: 0, cost: 0 };
}

function extractAssistantText(message: unknown): string {
  const content = toRecord(message)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    const value = toRecord(part);
    return value?.type === "text" && typeof value.text === "string" ? [value.text] : [];
  }).join("\n");
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? Object.fromEntries(Object.entries(value)) : null;
}
