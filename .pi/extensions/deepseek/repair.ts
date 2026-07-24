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

let _stampSeq = 0;

/**
 * DeepSeek 400s on tool_calls missing `id`. Give bare calls a fallback.
 */
export function stampMissingIds<T extends { id?: string }>(calls: T[]): Array<T & { id: string }> {
  return calls.map((call) => ({
    ...call,
    id: call.id ?? `z-ds-${Date.now().toString(36)}-${_stampSeq++}`,
  }));
}

/**
 * Drops both unpaired assistant.tool_calls and stray tool messages.
 * DeepSeek 400s on either.
 *
 * Returns the fixed messages array and counts of dropped items for telemetry.
 */
function fixToolCallPairing<T extends Record<string, unknown>>(
  messages: T[],
): {
  messages: T[];
  droppedAssistantCalls: number;
  droppedStrayTools: number;
} {
  const out: T[] = [];
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
      const candidates: T[] = [];
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

/**
 * Back-fills reasoning_content on bare assistant turns for thinking models.
 * DeepSeek V4/reasoner models require reasoning_content on every assistant
 * message in the context, even if empty string. Without it, the follow-up
 * request returns a 400 error.
 *
 * Skipped on non-thinking models to avoid unnecessary prefix-cache churn.
 */
function stampMissingReasoningForThinkingMode<T extends Record<string, unknown>>(
  messages: T[],
  model: string,
): { messages: T[]; stampedCount: number } {
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
  if (!input || !input.trim()) {
    return { repaired: "{}", changed: input !== "{}", notes: ["empty input → {}"], fallback: false };
  }
  try {
    JSON.parse(input);
    return { repaired: input, changed: false, notes: [], fallback: false };
  } catch {
    return repairInvalidJson(input);
  }
}

function repairInvalidJson(input: string): TruncationRepairResult {
  const notes: string[] = [];
  const repaired = closeJsonStructure(input, analyzeJsonStructure(input), notes);
  try {
    JSON.parse(repaired);
    return { repaired, changed: repaired !== input, notes, fallback: false };
  } catch (error) {
    const preview = input.length <= 500 ? input : `${input.slice(0, 500)} …[+${input.length - 500} chars]`;
    const message = error instanceof Error ? error.message : String(error);
    return {
      repaired: "{}",
      changed: true,
      notes: [...notes, `fallback to {}: ${message}`, `unrecoverable truncation — original args preview: ${preview}`],
      fallback: true,
    };
  }
}

function analyzeJsonStructure(input: string): { stack: string[]; inString: boolean; lastSignificant: number } {
  const stack: string[] = [];
  let escaped = false;
  let inString = false;
  let lastSignificant = -1;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (!/\s/.test(character)) lastSignificant = index;
    if (escaped) {
      escaped = false;
    } else if (inString && character === "\\") {
      escaped = true;
    } else if (character === '"') {
      inString = !inString;
      if (inString) stack.push('"');
      else stack.pop();
    } else if (!inString && (character === "{" || character === "[")) {
      stack.push(character);
    } else if (!inString && (character === "}" || character === "]")) {
      stack.pop();
    }
  }
  return { stack, inString, lastSignificant };
}

function closeJsonStructure(
  input: string,
  state: { stack: string[]; inString: boolean; lastSignificant: number },
  notes: string[],
): string {
  let repaired = input.slice(0, state.lastSignificant + 1);
  if (repaired.endsWith(",")) {
    repaired = repaired.slice(0, -1);
    notes.push("trimmed trailing comma");
  }
  if (/":\s*$/.test(repaired)) {
    repaired += " null";
    notes.push("filled dangling key with null");
  }
  if (state.inString) {
    repaired += '"';
    state.stack.pop();
    notes.push("closed unterminated string");
  }
  while (state.stack.length > 0) {
    const opener = state.stack.pop();
    if (opener === "{") repaired += "}";
    else if (opener === "[") repaired += "]";
  }
  return repaired;
}



/**
 * Apply all repair passes to a message array before sending to DeepSeek.
 * This is the main entry point for pre-flight message healing.
 */
export function healMessages<T extends Record<string, unknown>>(
  messages: T[],
  model: string,
): {
  messages: T[];
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
