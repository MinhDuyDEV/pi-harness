import type {
  AssistantMessage,
  Message,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { ToolOp } from "./compress-types.js";

export function estimateTokens(msg: Message): number {
  return Math.ceil(JSON.stringify(msg).length / 3.5);
}

function estimateToolArgsTokens(args: unknown): number {
  return Math.ceil(JSON.stringify(args).length / 4);
}

export function stripToolArgs(tc: ToolCall, marker: string): number {
  const before = estimateToolArgsTokens(tc.arguments);
  tc.arguments = { __dcp: marker };
  return before;
}

export function extractToolOps(messages: Message[]): ToolOp[] {
  const ops: ToolOp[] = [];
  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    if (msg.role === "assistant") {
      const asst = msg as AssistantMessage;
      if (!Array.isArray(asst.content)) continue;
      for (let ci = 0; ci < asst.content.length; ci++) {
        const part = asst.content[ci];
        if (part.type === "toolCall") {
          const tc = part as ToolCall;
          ops.push({
            messageIndex: mi,
            contentIndex: ci,
            type: "call",
            toolName: tc.name,
            toolCallId: tc.id,
            isError: false,
          });
        }
      }
      continue;
    }
    if (msg.role === "toolResult") {
      const tr = msg as ToolResultMessage;
      ops.push({
        messageIndex: mi,
        contentIndex: -1,
        type: "result",
        toolName: tr.toolName,
        toolCallId: tr.toolCallId,
        isError: tr.isError ?? false,
      });
    }
  }
  return ops;
}
