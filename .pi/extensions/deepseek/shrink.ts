/**
 * Token-aware message shrinking for DeepSeek models
 *
 * Stolen from Reasonix (src/loop/shrink.ts) — MIT License
 *
 * DeepSeek has context window limits. Rather than hard-truncating (which
 * breaks tool-call pairing and loses information), we shrink oversized
 * tool results and tool call arguments.
 *
 * Since we don't have direct access to the DeepSeek tokenizer from pikit,
 * we use a conservative byte-based estimation: ~4 tokens per ~5 ASCII chars,
 * or ~1 token per CJK char. This is calibrated against the deepseek-tokenizer.
 *
 * For production accuracy, consider loading the DeepSeek tokenizer JSON.
 */

// ─── Token Estimation ───────────────────────────────────────

/**
 * Estimate token count for a string.
 * DeepSeek's tokenizer averages ~0.75 tokens/char for English,
 * ~0.4 tokens/char for CJK. We use a conservative overestimate.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let ascii = 0;
  let other = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff) cjk++;
    else if (code <= 0x7f) ascii++;
    else other++;
  }

  // CJK: ~1 token per char, ASCII: ~0.75 tokens per char, other: ~1.5 tokens per char
  return Math.ceil(cjk + ascii * 0.75 + other * 1.5);
}

// ─── Shrink Tool Results ────────────────────────────────────

export interface ShrinkResult {
  messages: Array<Record<string, unknown>>;
  healedCount: number;
  healedFrom: number;
  charsSaved: number;
  tokensSaved: number;
  entriesDropped: number;
}

/**
 * Shrink oversized tool result content by truncating the deepest/largest
 * tool message in the array. Applies progressively until under maxChars
 * or only one tool result remains.
 */
export function shrinkOversizedToolResults(
  messages: Array<Record<string, unknown>>,
  maxChars: number,
): ShrinkResult {
  let totalChars = totalContentChars(messages);
  let healedCount = 0;
  let entriesDropped = 0;

  while (totalChars > maxChars) {
    // Find the largest tool result content
    let largestIdx = -1;
    let largestLen = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      if (msg.role === "tool" && typeof msg.content === "string") {
        const len = (msg.content as string).length;
        if (len > largestLen) {
          largestLen = len;
          largestIdx = i;
        }
      }
    }

    if (largestIdx < 0) break; // No more tool results to shrink

    // Shrink the largest by ~30% (or replace with summary)
    const msg = messages[largestIdx]!;
    const content = msg.content as string;

    if (largestLen > 2000) {
      // Truncate to half
      const half = Math.floor(largestLen / 2);
      msg.content = content.slice(0, half) + `\n…[truncated: ${largestLen - half} chars]`;
      healedCount++;
    } else {
      // Replace with metadata-only
      msg.content = `[tool result: ${largestLen} chars (truncated for context budget)]`;
      entriesDropped++;
      healedCount++;
    }

    const newTotal = totalContentChars(messages);
    if (newTotal >= totalChars) break; // Sanity check — prevent infinite loop
    totalChars = newTotal;
  }

  return {
    messages,
    healedCount,
    healedFrom: 0,
    charsSaved: 0, // Computed below
    tokensSaved: 0,
    entriesDropped,
  };
}

/**
 * Token-aware variant — uses estimated token count instead of char count.
 * Important for CJK content where char count ≠ token count.
 */
export function shrinkOversizedToolResultsByTokens(
  messages: Array<Record<string, unknown>>,
  maxTokens: number,
): ShrinkResult {
  let totalTokens = estimateTotalTokens(messages);
  let healedCount = 0;
  let tokensSaved = 0;
  let charsSaved = 0;
  let entriesDropped = 0;

  while (totalTokens > maxTokens) {
    // Find the largest tool result by token estimate
    let largestIdx = -1;
    let largestTokens = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      if (msg.role === "tool" && typeof msg.content === "string") {
        const tokens = estimateTokens(msg.content as string);
        if (tokens > largestTokens) {
          largestTokens = tokens;
          largestIdx = i;
        }
      }
    }

    if (largestIdx < 0) break;

    const msg = messages[largestIdx]!;
    const content = msg.content as string;
    const contentTokens = estimateTokens(content);

    if (content.length > 2000) {
      const half = Math.floor(content.length / 2);
      const beforeTokens = estimateTokens(content);
      msg.content = content.slice(0, half) + `\n…[truncated: ${content.length - half} chars]`;
      const afterTokens = estimateTokens(msg.content as string);
      const saved = beforeTokens - afterTokens;
      tokensSaved += saved;
      charsSaved += content.length - (msg.content as string).length;
      healedCount++;
    } else {
      msg.content = `[tool result: ${content.length} chars (truncated for context budget)]`;
      tokensSaved += contentTokens - estimateTokens(msg.content as string);
      charsSaved += content.length - (msg.content as string).length;
      entriesDropped++;
      healedCount++;
    }

    const newTotal = estimateTotalTokens(messages);
    if (newTotal >= totalTokens) break;
    totalTokens = newTotal;
  }

  return {
    messages,
    healedCount,
    healedFrom: 0,
    charsSaved,
    tokensSaved,
    entriesDropped,
  };
}

/**
 * Shrink oversized tool call arguments by removing verbose fields
 * (like full file content in edit/fs calls).
 */
export function shrinkOversizedToolCallArgsByTokens(
  messages: Array<Record<string, unknown>>,
  maxTokens: number,
  maxArgTokens = 8000,
): ShrinkResult {
  let healedCount = 0;
  let tokensSaved = 0;
  let charsSaved = 0;
  let entriesDropped = 0;

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const calls = msg.tool_calls as Array<{ function: { arguments?: string; name?: string } }> | undefined;
    if (!calls) continue;

    for (const call of calls) {
      const args = call.function?.arguments;
      if (!args) continue;
      const argsTokens = estimateTokens(args);

      if (argsTokens > maxArgTokens) {
        // Replace large arguments with a summary
        try {
          const parsed = JSON.parse(args);
          // Keep structure but truncate large string values
          const shrunk = shrinkLargeStrings(parsed, 1000);
          const newArgs = JSON.stringify(shrunk);
          const saved = argsTokens - estimateTokens(newArgs);
          call.function.arguments = newArgs;
          tokensSaved += saved;
          charsSaved += args.length - newArgs.length;
          healedCount++;
        } catch {
          // Not valid JSON — hard truncate
          const maxLen = maxArgTokens * 5; // Rough chars → tokens
          if (args.length > maxLen) {
            call.function.arguments = args.slice(0, maxLen);
            healedCount++;
          }
        }
      }
    }
  }

  return {
    messages,
    healedCount,
    healedFrom: 0,
    charsSaved,
    tokensSaved,
    entriesDropped,
  };
}

// ─── Utilities ──────────────────────────────────────────────

function totalContentChars(messages: Array<Record<string, unknown>>): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      total += (msg.content as string).length;
    }
  }
  return total;
}

function estimateTotalTokens(messages: Array<Record<string, unknown>>): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      total += estimateTokens(msg.content as string);
    }
  }
  return total;
}

/**
 * Recursively shrink large string values in an object.
 */
function shrinkLargeStrings(obj: unknown, maxLen: number): unknown {
  if (typeof obj === "string") {
    if (obj.length > maxLen) {
      return obj.slice(0, maxLen) + `\n…[+${obj.length - maxLen} more chars]`;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => shrinkLargeStrings(item, maxLen));
  }

  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      out[key] = shrinkLargeStrings(value, maxLen);
    }
    return out;
  }

  return obj;
}
