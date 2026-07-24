import type {
  Api,
  AssistantMessage,
  Model,
} from "@earendil-works/pi-ai";
import { emptyPartial } from "./format.js";

export interface DeepseekPartialState {
  message: AssistantMessage;
  textIndex?: number;
  thinkingIndex?: number;
  toolIndices: Map<number, number>;
}

export interface PartialDelta {
  started: boolean;
  contentIndex: number;
  startPartial?: AssistantMessage;
  partial: AssistantMessage;
}

export function createDeepseekPartialState(model: Model<Api>): DeepseekPartialState {
  return { message: emptyPartial(model), toolIndices: new Map() };
}

export function appendTextDelta(state: DeepseekPartialState, delta: string): PartialDelta {
  const started = state.textIndex === undefined;
  if (started) {
    state.textIndex = state.message.content.length;
    state.message.content.push({ type: "text", text: "" });
  }
  const startPartial = started ? snapshotPartial(state) : undefined;
  const contentIndex = state.textIndex!;
  const block = state.message.content[contentIndex];
  if (!block || block.type !== "text") throw new Error("DeepSeek text partial state is invalid");
  block.text += delta;
  return { started, contentIndex, startPartial, partial: snapshotPartial(state) };
}

export function appendThinkingDelta(state: DeepseekPartialState, delta: string): PartialDelta {
  const started = state.thinkingIndex === undefined;
  if (started) {
    state.thinkingIndex = state.message.content.length;
    state.message.content.push({ type: "thinking", thinking: "" });
  }
  const startPartial = started ? snapshotPartial(state) : undefined;
  const contentIndex = state.thinkingIndex!;
  const block = state.message.content[contentIndex];
  if (!block || block.type !== "thinking") throw new Error("DeepSeek thinking partial state is invalid");
  block.thinking += delta;
  return { started, contentIndex, startPartial, partial: snapshotPartial(state) };
}

export function appendToolDelta(
  state: DeepseekPartialState,
  toolIndex: number,
  id: string | undefined,
  name: string | undefined,
): PartialDelta {
  const existingIndex = state.toolIndices.get(toolIndex);
  const started = existingIndex === undefined;
  const contentIndex = existingIndex ?? state.message.content.length;
  if (started) {
    state.toolIndices.set(toolIndex, contentIndex);
    state.message.content.push({
      type: "toolCall",
      id: id ?? `deepseek_tool_${toolIndex}`,
      name: name ?? "",
      arguments: {},
    });
  }
  const startPartial = started ? snapshotPartial(state) : undefined;
  const block = state.message.content[contentIndex];
  if (!block || block.type !== "toolCall") throw new Error("DeepSeek tool partial state is invalid");
  if (id) block.id = id;
  if (name) block.name = name;
  return { started, contentIndex, startPartial, partial: snapshotPartial(state) };
}

export function finalizePartial(
  state: DeepseekPartialState,
  message: AssistantMessage,
): AssistantMessage {
  state.message = { ...message, content: [...message.content] };
  return snapshotPartial(state);
}

export function snapshotPartial(state: DeepseekPartialState): AssistantMessage {
  return {
    ...state.message,
    content: state.message.content.map((block) => {
      if (block.type === "toolCall") return { ...block, arguments: { ...block.arguments } };
      return { ...block };
    }),
  };
}
