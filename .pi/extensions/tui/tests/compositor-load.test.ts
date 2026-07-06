import { describe, it, expect } from "bun:test";
describe("load", () => {
  it("loads compositor from tests dir", async () => {
    const mod = await import("../fixed-editor/compositor.js");
    expect(typeof mod.FixedEditorCompositor).toBe("function");
  });
});
