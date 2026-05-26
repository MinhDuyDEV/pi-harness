/**
 * Storm Breaker — repeat-loop guard for tool calls
 *
 * Stolen from Reasonix (src/repair/storm.ts) — MIT License
 *
 * DeepSeek models sometimes enter infinite loops calling the same tool
 * with identical arguments. This detector tracks recent tool calls and
 * suppresses repeats when the same (name, args) pair appears N times
 * within a sliding window.
 *
 * Mutating tool calls (edits, shell commands) clear prior read-only entries
 * (reads, searches) from the window, because a state change invalidates
 * prior read results. But mutators still count amongst themselves —
 * 3 identical edits in a row is still a storm.
 */

export type IsMutatingFn = (call: ToolCall) => boolean;
export type IsStormExemptFn = (call: ToolCall) => boolean;

interface RecentEntry {
  name: string;
  args: string;
  readOnly: boolean;
}

export interface ToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface StormResult {
  suppress: boolean;
  reason?: string;
}

/**
 * Tracks (name, args) repeats; mutating calls clear prior read-only entries
 * while still counting amongst themselves within the sliding window.
 */
export class StormBreaker {
  private readonly windowSize: number;
  private readonly threshold: number;
  private readonly isMutating: IsMutatingFn | undefined;
  private readonly isStormExempt: IsStormExemptFn | undefined;
  private readonly recent: RecentEntry[] = [];

  constructor(
    windowSize = 6,
    threshold = 3,
    isMutating?: IsMutatingFn,
    isStormExempt?: IsStormExemptFn,
  ) {
    this.windowSize = windowSize;
    this.threshold = threshold;
    this.isMutating = isMutating;
    this.isStormExempt = isStormExempt;
  }

  /**
   * Inspect a tool call for storm detection.
   * Returns { suppress: true } with a reason if this call should be suppressed.
   */
  inspect(call: ToolCall): StormResult {
    const name = call.function?.name;
    if (!name) return { suppress: false };

    if (this.isStormExempt?.(call)) return { suppress: false };

    const args = call.function?.arguments ?? "";
    const mutating = this.isMutating ? this.isMutating(call) : false;
    const readOnly = !mutating;

    if (mutating) {
      // Drop prior read-only entries — the file/shell state just changed,
      // so a verify-read after this should start with a clean slate.
      // Keep mutator entries: 3 identical edits in a row is still a storm.
      for (let i = this.recent.length - 1; i >= 0; i--) {
        if (this.recent[i]!.readOnly) this.recent.splice(i, 1);
      }
    }

    // Count how many times this exact (name, args) appears in the window
    let count = 0;
    for (const entry of this.recent) {
      if (entry.name === name && entry.args === args) count++;
    }

    if (count >= this.threshold - 1) {
      return {
        suppress: true,
        reason: `${name} called with identical args ${count + 1} times — repeat-loop guard tripped`,
      };
    }

    this.recent.push({ name, args, readOnly });
    while (this.recent.length > this.windowSize) this.recent.shift();

    return { suppress: false };
  }

  /** Reset the window (call on new turns). */
  reset(): void {
    this.recent.length = 0;
  }
}

/**
 * Default mutation detector — edit/fs/file/write operations are mutating.
 */
export const defaultIsMutating: IsMutatingFn = (call) => {
  const name = call.function?.name ?? "";
  const mutating = [
    "edit",
    "write",
    "create",
    "delete",
    "rename",
    "move",
    "copy",
    "mkdir",
    "bash",
    "shell",
    "run",
    "exec",
    "install",
    "npm",
    "bun",
    "pip",
    "cargo",
  ];
  return mutating.some((m) => name.toLowerCase().includes(m));
};
