import type { AssistantMessage } from "@earendil-works/pi-ai";

export function assistantMessage(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: "test",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}
