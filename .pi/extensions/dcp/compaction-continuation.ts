import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CompactionContinuationConfig } from "./config.js";

export interface CompactionSignal {
  reason: "manual" | "threshold" | "overflow";
  willRetry: boolean;
}

export function shouldResumeCompaction(
  signal: CompactionSignal,
  continuationInflight: boolean,
): boolean {
  if (signal.willRetry) return false;
  if (signal.reason === "manual" || signal.reason === "overflow") return true;
  return !continuationInflight;
}

export function buildContinuationPrompt(compactionEntryId: string): string {
  return `Compaction completed at entry ${JSON.stringify(compactionEntryId)}. Resume the existing task now.

Treat the compacted summary as the working history and the current worktree as authoritative for file state. Recover the original goal, constraints, completed work, verification already observed, and the next unfinished step. Use dcp_recall only when an exact earlier detail is required. Continue with that step immediately; do not stop after a recap or ask the user to repeat context unless the available state is genuinely ambiguous.`;
}

/** Register one coalesced, retry-aware continuation state machine. */
export function registerCompactionContinuation(
  pi: ExtensionAPI,
  config: CompactionContinuationConfig,
): void {
  if (!config.enabled) return;

  let continuationInflight = false;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  const reset = () => {
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    pendingTimer = undefined;
    continuationInflight = false;
  };

  pi.on("session_compact", (event, ctx) => {
    const signal: CompactionSignal = {
      reason: event.reason,
      willRetry: event.willRetry,
    };
    if (!shouldResumeCompaction(signal, continuationInflight)) return;

    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    continuationInflight = true;
    const prompt = buildContinuationPrompt(event.compactionEntry.id);

    pendingTimer = setTimeout(() => {
      pendingTimer = undefined;
      const options = ctx.isIdle() ? undefined : { deliverAs: "followUp" as const };
      try {
        pi.sendUserMessage(prompt, options);
      } catch {
        continuationInflight = false;
      }
    }, config.delayMs);
  });

  pi.on("agent_settled", () => {
    continuationInflight = false;
  });
  pi.on("session_start", reset);
  pi.on("session_shutdown", reset);
}
