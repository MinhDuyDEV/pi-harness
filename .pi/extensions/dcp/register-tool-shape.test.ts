import { describe, expect, test } from "bun:test";
import { registerCompressTool } from "./compress-tool.ts";
import { registerRecallTool } from "./recall.ts";
import { DEFAULT_CONFIG } from "./config.ts";

type RegisteredTool = {
  name?: string;
  description?: string;
  parameters?: unknown;
  execute?: unknown;
};

function mockApi() {
  const tools: RegisteredTool[] = [];
  return {
    tools,
    api: {
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
      on() {},
      appendEntry() {},
    } as never,
  };
}

describe("DCP registerTool shape", () => {
  test("compress registers ToolDefinition with name + parameters", () => {
    const { tools, api } = mockApi();
    registerCompressTool(api, DEFAULT_CONFIG);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("compress");
    expect(tools[0]?.parameters).toBeDefined();
    expect(typeof tools[0]?.execute).toBe("function");
    // Simulate OpenAI Responses serialization: undefined name is omitted
    const payload = JSON.parse(
      JSON.stringify({
        type: "function",
        name: tools[0]?.name,
        description: tools[0]?.description,
        parameters: tools[0]?.parameters,
        strict: false,
      }),
    );
    expect(payload.name).toBe("compress");
    expect(payload.parameters).toBeDefined();
  });

  test("dcp_recall registers ToolDefinition with name + parameters", () => {
    const { tools, api } = mockApi();
    registerRecallTool(api);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("dcp_recall");
    expect(tools[0]?.parameters).toBeDefined();
    expect(typeof tools[0]?.execute).toBe("function");
    const payload = JSON.parse(
      JSON.stringify({
        type: "function",
        name: tools[0]?.name,
        description: tools[0]?.description,
        parameters: tools[0]?.parameters,
        strict: false,
      }),
    );
    expect(payload.name).toBe("dcp_recall");
  });

  test("legacy multi-arg form would omit name (regression guard)", () => {
    // Documents the failure mode: registerTool(string) → tool.name undefined
    const tool = "compress" as unknown as { name?: string };
    const payload = JSON.parse(
      JSON.stringify({
        type: "function",
        name: (tool as { name?: string }).name,
        strict: false,
      }),
    );
    expect(payload).toEqual({ type: "function", strict: false });
    expect(payload.name).toBeUndefined();
  });
});
