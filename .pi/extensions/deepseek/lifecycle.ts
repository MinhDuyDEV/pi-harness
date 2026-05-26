/**
 * Lifecycle — structured event lifecycle for DeepSeek provider
 *
 * Inspired by OpenCode's Lifecycle utility (opencode-ai/opencode).
 * Converts raw SSE deltas into structured events with proper
 * start/delta/end boundaries for reasoning, text, and tool calls.
 *
 * Unlike OpenCode which uses Effect TS, this is plain async/await.
 */

// ─── Types ──────────────────────────────────────────────────

export interface ReasoningStart {
  type: "reasoning_start";
  id: string;
}

export interface ReasoningDelta {
  type: "reasoning_delta";
  id: string;
  text: string;
}

export interface ReasoningEnd {
  type: "reasoning_end";
  id: string;
}

export interface TextDelta {
  type: "text_delta";
  id: string;
  text: string;
}

export interface ToolCallStart {
  type: "tool_call_start";
  id: string;
  index: number;
  name?: string;
}

export interface ToolCallDelta {
  type: "tool_call_delta";
  id: string;
  index: number;
  arguments: string;
}

export interface ToolCallEnd {
  type: "tool_call_end";
  id: string;
  index: number;
}

export interface StepStart {
  type: "step_start";
}

export interface Finish {
  type: "finish";
  reason: "stop" | "length" | "content-filter" | "tool-calls" | "unknown";
}

export type LifecycleEvent =
  | ReasoningStart
  | ReasoningDelta
  | ReasoningEnd
  | TextDelta
  | ToolCallStart
  | ToolCallDelta
  | ToolCallEnd
  | StepStart
  | Finish;

// ─── State ──────────────────────────────────────────────────

export interface LifecycleState {
  readonly reasoning: ReadonlySet<string>;
  readonly content: ReadonlySet<string>;
  stepStarted: boolean;
}

export function initialLifecycleState(): LifecycleState {
  return { reasoning: new Set(), content: new Set(), stepStarted: false };
}

// ─── Lifecycle Helpers ──────────────────────────────────────

function ensureStepStarted(
  state: LifecycleState,
  events: LifecycleEvent[],
): LifecycleState {
  if (state.stepStarted) return state;
  events.push({ type: "step_start" });
  return { ...state, stepStarted: true };
}

export function reasoningDelta(
  state: LifecycleState,
  events: LifecycleEvent[],
  id: string,
  text: string,
): LifecycleState {
  const started = reasoningStart(state, events, id);
  events.push({ type: "reasoning_delta", id, text });
  return started;
}

export function reasoningStart(
  state: LifecycleState,
  events: LifecycleEvent[],
  id: string,
): LifecycleState {
  if (state.reasoning.has(id)) return state;
  const stepped = ensureStepStarted(state, events);
  events.push({ type: "reasoning_start", id });
  return { ...stepped, reasoning: new Set([...stepped.reasoning, id]) };
}

export function reasoningEnd(
  state: LifecycleState,
  events: LifecycleEvent[],
  id: string,
): LifecycleState {
  if (!state.reasoning.has(id)) return state;
  events.push({ type: "reasoning_end", id });
  const reasoning = new Set(state.reasoning);
  reasoning.delete(id);
  return { ...state, reasoning };
}

export function textDelta(
  state: LifecycleState,
  events: LifecycleEvent[],
  id: string,
  text: string,
): LifecycleState {
  const stepped = ensureStepStarted(state, events);
  events.push({ type: "text_delta", id, text });
  return stepped;
}

export function toolCallStart(
  state: LifecycleState,
  events: LifecycleEvent[],
  index: number,
  toolId: string,
  name?: string,
): LifecycleState {
  const stepped = ensureStepStarted(state, events);
  events.push({ type: "tool_call_start", id: toolId, index, name });
  return stepped;
}

export function toolCallDelta(
  state: LifecycleState,
  events: LifecycleEvent[],
  index: number,
  toolId: string,
  args: string,
): LifecycleState {
  const stepped = ensureStepStarted(state, events);
  events.push({ type: "tool_call_delta", id: toolId, index, arguments: args });
  return stepped;
}

export function toolCallEnd(
  state: LifecycleState,
  events: LifecycleEvent[],
  index: number,
  toolId: string,
): LifecycleState {
  events.push({ type: "tool_call_end", id: toolId, index });
  return state;
}

/**
 * Map DeepSeek's finish_reason to a standard reason.
 * Critical: if tool calls are present, "stop" becomes "tool-calls".
 */
export function mapFinishReason(
  reason: string | null | undefined,
  hasToolCalls: boolean,
): "stop" | "length" | "content-filter" | "tool-calls" | "unknown" {
  if (reason === "stop") return hasToolCalls ? "tool-calls" : "stop";
  if (reason === "length") return "length";
  if (reason === "content_filter") return "content-filter";
  if (reason === "function_call" || reason === "tool_calls") return "tool-calls";
  return "unknown";
}

export function finish(
  state: LifecycleState,
  events: LifecycleEvent[],
  reason: "stop" | "length" | "content-filter" | "tool-calls" | "unknown",
): LifecycleState {
  events.push({ type: "finish", reason });
  return state;
}
