/**
 * Budget Coordinator
 *
 * Ranked, token-budgeted injection for context reconstruction on pi restart.
 *
 * When pi restarts, multiple sources compete for injection into the system prompt:
 *   1. Session checkpoint (discoveries, files, progress)
 *   2. Active tasks (TODO.md / PROGRESS.md checkboxes)
 *   3. Memory observations (relevant to session context)
 *   4. Persona / learned patterns
 *   5. Scene context
 *
 * This module allocates the token budget from highest-priority sources down,
 * ensuring critical context is never crowded out by low-priority noise.
 */

// Default budget allocation (out of 100 priority points)
export const DEFAULT_PRIORITIES: Record<string, number> = {
  checkpoint: 35, // highest — what was accomplished
  tasks: 25, // what's in progress
  memory: 15, // relevant observations
  persona: 15, // learned patterns
  scenes: 10, // context flags
};

// Default token budget for injection (matches memory/config.ts default)
export const DEFAULT_TOKEN_BUDGET = 2000;

export interface InjectionSource {
  name: string;
  content: string;
  /**
   * Override priority (0-100). Uses DEFAULT_PRIORITIES[name] if unset.
   * Higher = more important, injected first.
   */
  priority?: number;
}

/**
 * Estimate token count for a string.
 * Rough heuristic: ~1 token per 4 chars for English text.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface BudgetResult {
  /** Content strings selected for injection, in priority order */
  selected: string[];
  /** Sources excluded due to budget constraints */
  excluded: string[];
  /** Token counts for visibility */
  tokensUsed: number;
  tokenBudget: number;
}

/**
 * Allocate token budget across injection sources by priority.
 *
 * Sources are sorted by priority (descending), then filled until the
 * token budget is exhausted. Low-priority sources are silently dropped.
 */
export function allocateBudget(
  sources: InjectionSource[],
  tokenBudget: number = DEFAULT_TOKEN_BUDGET,
): BudgetResult {
  // Assign priorities, sort descending
  const ranked = sources
    .map((s) => ({
      ...s,
      priority: s.priority ?? DEFAULT_PRIORITIES[s.name] ?? 5,
      estimatedTokens: estimateTokens(s.content),
    }))
    .sort((a, b) => b.priority - a.priority);

  const selected: string[] = [];
  const excluded: string[] = [];
  let tokensUsed = 0;

  for (const source of ranked) {
    if (!source.content || source.content.length === 0) {
      continue;
    }

    const remaining = tokenBudget - tokensUsed;
    if (remaining <= 0) {
      excluded.push(source.name);
      continue;
    }

    if (source.estimatedTokens > remaining) {
      const maxChars = Math.max(0, remaining * 4 - 64);
      if (maxChars > 0) {
        selected.push(`${source.content.slice(0, maxChars)}\n\n[Truncated: ${source.name} exceeded remaining context budget]`);
        tokensUsed = tokenBudget;
      }
      excluded.push(source.name);
      continue;
    }

    selected.push(source.content);
    tokensUsed += source.estimatedTokens;
  }

  return { selected, excluded, tokensUsed, tokenBudget };
}
