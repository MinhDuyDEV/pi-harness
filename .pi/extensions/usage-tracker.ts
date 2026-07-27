import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  estimateTokens,
  extractModel,
  extractProvider,
  fallbackUsageFromMessage,
  formatCost,
  formatTokens,
  normalizeUsage,
  type NormalizedUsage,
} from "./usage/normalize.js";
import {
  closeUsageDatabase,
  getGlobalUsage,
  getModelBreakdown,
  getTodayUsage,
  getUsageDatabase,
  recordUsage,
} from "./usage/storage.js";
import { readExtensionGate } from "./lib/harness-settings.js";

export default function usageTrackerExtension(pi: ExtensionAPI): void {
  if (!readExtensionGate(undefined, "usageTracker", false)) return;
  try {
    getUsageDatabase();
  } catch (error) {
    console.error("[usage-tracker] Failed to initialize database:", error);
    return;
  }
  let currentTurn = 0;
  let currentSessionId = "default";
  let lastRecordedTurn = -1;
  let lastInputEstimate = 0;
  let usageDisabled = false;

  pi.on("input", (event) => {
    currentTurn += 1;
    const value = toRecord(event);
    if (typeof value?.sessionId === "string") currentSessionId = value.sessionId;
    const text = typeof event === "string" ? event : value?.text ?? value?.content ?? "";
    if (typeof text === "string") lastInputEstimate = estimateTokens(text);
  });

  pi.on("turn_end", (event) => {
    if (usageDisabled) return;
    try {
      const value = toRecord(event);
      const message = toRecord(value?.message);
      const usage = usageFromEvent(value, message, lastRecordedTurn === currentTurn ? 0 : lastInputEstimate);
      if (!usage) return;
      recordEventUsage(value, message, usage, currentSessionId, currentTurn);
      lastRecordedTurn = currentTurn;
    } catch (error) {
      usageDisabled = true;
      console.warn("pi-harness usage-tracker: disabling usage recording:", error instanceof Error ? error.message : error);
      return;
    }
  });

  pi.on("message_end", (event) => {
    if (usageDisabled) return;
    try {
      const value = toRecord(event);
      const message = toRecord(value?.message);
      if (message?.role !== "assistant" || lastRecordedTurn === currentTurn) return;
      const usage = normalizeUsage(message.usage ?? value?.usage) ?? fallbackUsageFromMessage(message, lastInputEstimate);
      if (!usage) return;
      recordEventUsage(value, message, usage, currentSessionId, currentTurn);
      lastRecordedTurn = currentTurn;
    } catch (error) {
      usageDisabled = true;
      console.warn("pi-harness usage-tracker: disabling usage recording:", error instanceof Error ? error.message : error);
      return;
    }
  });

  pi.registerCommand("usage", {
    description: "Show token usage and cost statistics",
    async handler(_args, ctx) {
      try {
        ctx.ui.notify(renderUsageReport());
      } catch (error) {
        ctx.ui.notify(`Usage stats error: ${error}`);
      }
    },
  });

  pi.on("session_shutdown", closeUsageDatabase);
}

function usageFromEvent(
  event: Record<string, unknown> | null,
  message: Record<string, unknown> | null,
  lastInputEstimate: number,
): NormalizedUsage | null {
  const response = toRecord(event?.response);
  const result = toRecord(event?.result);
  return normalizeUsage(message?.usage ?? event?.usage ?? response?.usage ?? result?.usage)
    ?? fallbackUsageFromMessage(message, lastInputEstimate);
}

function recordEventUsage(
  event: Record<string, unknown> | null,
  message: Record<string, unknown> | null,
  usage: NormalizedUsage,
  currentSessionId: string,
  currentTurn: number,
): void {
  const eventModel = toRecord(event?.model);
  const modelId = firstString(message?.model, eventModel?.id, event?.modelId, event?.model) ?? "unknown";
  const provider = firstString(message?.provider) ?? extractProvider(modelId);
  const sessionId = firstString(event?.sessionId) ?? currentSessionId;
  recordUsage(
    sessionId,
    extractModel(modelId),
    provider,
    usage.input,
    usage.output,
    usage.cacheRead,
    usage.cacheWrite,
    usage.thinking,
    usage.cost,
    currentTurn,
  );
}

function renderUsageReport(): string {
  const today = getTodayUsage();
  const global = getGlobalUsage();
  const lines = [
    "## Usage Statistics\n",
    "### Today",
    `  Input: ${formatTokens(today.input)} | Output: ${formatTokens(today.output)} | Cost: ${formatCost(today.cost)} | Turns: ${today.turns}`,
    "",
    "### All Time",
    `  Sessions: ${global.totalSessions}`,
    `  Input: ${formatTokens(global.totalInput)} | Output: ${formatTokens(global.totalOutput)}`,
    `  Cache: ${formatTokens(global.totalCache)} | Thinking: ${formatTokens(global.totalThinking)}`,
    `  Total cost: ${formatCost(global.totalCost)} | Total turns: ${global.totalTurns}`,
  ];
  const models = getModelBreakdown(7);
  if (models.length > 0) {
    lines.push("", "### Models (last 7 days)");
    for (const model of models) {
      const total = model.input_tokens + model.output_tokens;
      lines.push(`  ${model.provider}/${model.model}: ${formatTokens(total)} tokens (${model.calls} calls) ${formatCost(model.total_cost)}`);
    }
  }
  return lines.join("\n");
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? Object.fromEntries(Object.entries(value)) : null;
}
