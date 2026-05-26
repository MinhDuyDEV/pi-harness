/**
 * Tool-call message repair for DeepSeek models
 *
 * Stolen from Reasonix (src/repair/, src/loop/healing.ts) — MIT License
 *
 * DeepSeek has specific failure modes with tool calls:
 * 1. Missing `id` on tool_calls → 400 error
 * 2. Unpaired assistant.tool_calls (no matching tool responses) → 400
 * 3. Stray tool messages (no matching assistant.tool_calls) → 400
 * 4. reasoning_content missing on thinking-model assistant messages → 400
 * 5. Truncated JSON in tool_call arguments → parse failure
 */

import { isThinkingModeModel } from "./thinking.js";

// ─── Tool Call ID Stamping ──────────────────────────────────

let _stampSeq = 0;

/**
 * DeepSeek 400s on tool_calls missing `id`. Give bare calls a fallback.
 */
export function stampMissingIds(
  calls: Array<{ id?: string; [key: string]: unknown }>,
): Array<{ id: string; [key: string]: unknown }> {
  return calls.map((c) =>
    c.id ? (c as { id: string; [key: string]: unknown }) : { ...c, id: `z-ds-${Date.now().toString(36)}-${_stampSeq++}` },
  );
}

// ─── Tool Call Pairing Fix ──────────────────────────────────

/**
 * Drops both unpaired assistant.tool_calls and stray tool messages.
 * DeepSeek 400s on either.
 *
 * Returns the fixed messages array and counts of dropped items for telemetry.
 */
export function fixToolCallPairing(
  messages: Array<Record<string, unknown>>,
): {
  messages: Array<Record<string, unknown>>;
  droppedAssistantCalls: number;
  droppedStrayTools: number;
} {
  const out: Array<Record<string, unknown>> = [];
  let droppedAssistantCalls = 0;
  let droppedStrayTools = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;

    if (
      msg.role === "assistant" &&
      Array.isArray(msg.tool_calls) &&
      msg.tool_calls.length > 0
    ) {
      // Stamp missing ids before validation — DeepSeek rejects tool_calls without id
      const calls = stampMissingIds(msg.tool_calls as Array<{ id?: string }>);
      const needed = new Set<string>();
      for (const call of calls) {
        if (call.id) needed.add(call.id);
      }

      // Look ahead for matching tool responses
      const candidates: Array<Record<string, unknown>> = [];
      let j = i + 1;
      while (j < messages.length && needed.size > 0) {
        const nxt = messages[j]!;
        if (nxt.role !== "tool") break;
        const id = (nxt.tool_call_id as string) ?? "";
        if (!needed.has(id)) break;
        needed.delete(id);
        candidates.push(nxt);
        j++;
      }

      if (needed.size === 0) {
        // All tool calls have matching responses — keep everything
        out.push({ ...msg, tool_calls: calls });
        for (const r of candidates) out.push(r);
        i = j - 1;
      } else {
        // Unpaired assistant.tool_calls — drop this block entirely
        droppedAssistantCalls += 1;
        droppedStrayTools += candidates.length;
        i = j - 1;
      }
      continue;
    }

    if (msg.role === "tool") {
      // Stray tool message with no matching assistant.tool_calls ahead
      droppedStrayTools += 1;
      continue;
    }

    out.push(msg);
  }

  return { messages: out, droppedAssistantCalls, droppedStrayTools };
}

// ─── reasoning_content Stamping ─────────────────────────────

/**
 * Back-fills reasoning_content on bare assistant turns for thinking models.
 * DeepSeek V4/reasoner models require reasoning_content on every assistant
 * message in the context, even if empty string. Without it, the follow-up
 * request returns a 400 error.
 *
 * Skipped on non-thinking models to avoid unnecessary prefix-cache churn.
 */
export function stampMissingReasoningForThinkingMode(
  messages: Array<Record<string, unknown>>,
  model: string,
): { messages: Array<Record<string, unknown>>; stampedCount: number } {
  if (!isThinkingModeModel(model)) {
    return { messages, stampedCount: 0 };
  }

  let stampedCount = 0;
  const out = messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    if (Object.prototype.hasOwnProperty.call(msg, "reasoning_content")) return msg;
    stampedCount += 1;
    return { ...msg, reasoning_content: "" };
  });

  return { messages: out, stampedCount };
}

// ─── Truncated JSON Repair ──────────────────────────────────

export interface TruncationRepairResult {
  repaired: string;
  changed: boolean;
  notes: string[];
  /** True when all repair attempts failed and the result falls back to "{}" */
  fallback: boolean;
}

/**
 * Repairs truncated JSON tool call arguments from DeepSeek models.
 *
 * DeepSeek V4/reasoner models frequently truncate tool call arguments
 * mid-JSON when the model hits token limits. This function:
 * 1. Closes unterminated strings
 * 2. Fills dangling keys with null
 * 3. Closes unclosed braces/brackets
 * 4. Trims trailing commas
 * 5. Falls back to "{}" only when unrecoverable
 */
export function repairTruncatedJson(input: string): TruncationRepairResult {
  const notes: string[] = [];

  if (!input || !input.trim()) {
    return {
      repaired: "{}",
      changed: input !== "{}",
      notes: ["empty input → {}"],
      fallback: false,
    };
  }

  // Fast path: already parseable
  try {
    JSON.parse(input);
    return { repaired: input, changed: false, notes: [], fallback: false };
  } catch {
    // Fall through to repair
  }

  const stack: string[] = [];
  let escaped = false;
  let inString = false;
  let lastSignificant = -1;

  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (!/\s/.test(c)) lastSignificant = i;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString) {
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        stack.pop();
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      stack.push('"');
      continue;
    }

    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }

  let s = input.slice(0, lastSignificant + 1);

  // Trim a trailing comma which would block re-parse
  if (/,$/.test(s)) {
    s = s.replace(/,$/, "");
    notes.push("trimmed trailing comma");
  }

  // If we ended on a key without a value: "foo": → "foo": null
  if (/":\s*$/.test(s)) {
    s += " null";
    notes.push("filled dangling key with null");
  }

  // If we ended inside a string, close it
  if (inString) {
    s += '"';
    stack.pop();
    notes.push("closed unterminated string");
  }

  // Pop remaining open structures in reverse order
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === "{") s += "}";
    else if (top === "[") s += "]";
  }

  // Attempt to parse the repaired string
  try {
    JSON.parse(s);
    return { repaired: s, changed: s !== input, notes, fallback: false };
  } catch (err) {
    const preview =
      input.length <= 500
        ? input
        : `${input.slice(0, 500)} …[+${input.length - 500} chars]`;
    notes.push(`fallback to {}: ${(err as Error).message}`);
    notes.push(`unrecoverable truncation — original args preview: ${preview}`);
    return { repaired: "{}", changed: true, notes, fallback: true };
  }
}

/**
 * Apply repairTruncatedJson to all tool_calls in an assistant message.
 */
export function repairAllToolCallArgs(
  msg: { tool_calls?: Array<{ function: { arguments?: string } }> },
): { repaired: number; fallbacks: number } {
  if (!msg.tool_calls) return { repaired: 0, fallbacks: 0 };
  let repaired = 0;
  let fallbacks = 0;

  for (const call of msg.tool_calls) {
    const args = call.function?.arguments;
    if (!args) continue;
    const result = repairTruncatedJson(args);
    if (result.changed) {
      call.function.arguments = result.repaired;
      repaired++;
      if (result.fallback) fallbacks++;
    }
  }

  return { repaired, fallbacks };
}

// ─── Combined Healing ───────────────────────────────────────

/**
 * Apply all repair passes to a message array before sending to DeepSeek.
 * This is the main entry point for pre-flight message healing.
 */
export function healMessages(
  messages: Array<Record<string, unknown>>,
  model: string,
  maxChars = 500_000,
): {
  messages: Array<Record<string, unknown>>;
  healedCount: number;
} {
  let healedCount = 0;

  // 1. Fix tool call pairing (drop orphans)
  const paired = fixToolCallPairing(messages);
  healedCount += paired.droppedAssistantCalls + paired.droppedStrayTools;

  // 2. Stamp reasoning_content for thinking models
  const stamped = stampMissingReasoningForThinkingMode(paired.messages, model);
  healedCount += stamped.stampedCount;

  return { messages: stamped.messages, healedCount };
}
