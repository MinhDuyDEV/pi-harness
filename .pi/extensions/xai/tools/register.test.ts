import assert from "node:assert/strict";
import { test } from "node:test";
import { Type } from "typebox";
import { defineXaiTool } from "./define-tool.js";
import { adaptXaiTool } from "./register.js";

test("xAI tool adapter maps Pi positional arguments to the typed tool input", async () => {
  let received: unknown;
  const tool = defineXaiTool({
    name: "xai_test",
    label: "xAI Test",
    description: "Adapter test",
    parameters: Type.Object({ value: Type.String() }),
    async execute(input) {
      received = input;
      return { content: [{ type: "text", text: input.params.value }], details: undefined };
    },
  });
  const registered = adaptXaiTool(tool);
  const signal = new AbortController().signal;
  const onUpdate = () => undefined;
  const ctx = { test: true };

  const result = await registered.execute("call-1", { value: "ok" }, signal, onUpdate, ctx as never);

  assert.deepEqual(result.content, [{ type: "text", text: "ok" }]);
  assert.deepEqual(received, {
    toolCallId: "call-1",
    params: { value: "ok" },
    signal,
    onUpdate,
    ctx,
  });
});
