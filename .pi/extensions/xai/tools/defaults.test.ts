import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolveXaiToolConfig } from "./defaults";

let prevEnable: string | undefined;
let prevDisable: string | undefined;

beforeEach(() => {
  prevEnable = process.env.PI_XAI_ENABLE_TOOLS;
  prevDisable = process.env.PI_XAI_DISABLE_TOOLS;
  delete process.env.PI_XAI_ENABLE_TOOLS;
  delete process.env.PI_XAI_DISABLE_TOOLS;
});

afterEach(() => {
  if (prevEnable === undefined) delete process.env.PI_XAI_ENABLE_TOOLS;
  else process.env.PI_XAI_ENABLE_TOOLS = prevEnable;
  if (prevDisable === undefined) delete process.env.PI_XAI_DISABLE_TOOLS;
  else process.env.PI_XAI_DISABLE_TOOLS = prevDisable;
});

describe("XAI tool defaults", () => {
  it("returns no enabled tools by default", () => {
    const result = resolveXaiToolConfig();
    expect(result.size).toBe(0);
  });

  it("PI_XAI_ENABLE_TOOLS adds tools to the enabled set", () => {
    process.env.PI_XAI_ENABLE_TOOLS = "xai_multi_agent,xai_deep_research";
    const result = resolveXaiToolConfig();
    expect(result.has("xai_multi_agent")).toBe(true);
    expect(result.has("xai_deep_research")).toBe(true);
  });

  it("PI_XAI_DISABLE_TOOLS removes tools from the enabled set", () => {
    process.env.PI_XAI_DISABLE_TOOLS = "xai_web_search,xai_x_search";
    const result = resolveXaiToolConfig();
    expect(result.has("xai_web_search")).toBe(false);
    expect(result.has("xai_x_search")).toBe(false);
  });

  it("PI_XAI_DISABLE_TOOLS wins when a tool is in both env vars", () => {
    process.env.PI_XAI_ENABLE_TOOLS = "xai_multi_agent";
    process.env.PI_XAI_DISABLE_TOOLS = "xai_multi_agent";
    const result = resolveXaiToolConfig();
    expect(result.has("xai_multi_agent")).toBe(false);
  });

  it("PI_XAI_ENABLE_TOOLS=* enables all 9 tools", () => {
    process.env.PI_XAI_ENABLE_TOOLS = "*";
    const result = resolveXaiToolConfig();
    expect(result.size).toBe(9);
  });

  it("PI_XAI_DISABLE_TOOLS=* disables all 9 tools", () => {
    process.env.PI_XAI_DISABLE_TOOLS = "*";
    const result = resolveXaiToolConfig();
    expect(result.size).toBe(0);
  });

  it("ignores unknown tool names without throwing", () => {
    process.env.PI_XAI_ENABLE_TOOLS = "xai_not_real,xai_web_search";
    process.env.PI_XAI_DISABLE_TOOLS = "xai_also_fake";
    // Suppress the warning so the test output stays clean.
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const result = resolveXaiToolConfig();
      expect(result.has("xai_web_search")).toBe(true);
      expect(result.has("xai_not_real")).toBe(false);
    } finally {
      console.warn = origWarn;
    }
  });

  it("trims whitespace and filters empty entries", () => {
    process.env.PI_XAI_ENABLE_TOOLS = " xai_multi_agent , , xai_deep_research ";
    const result = resolveXaiToolConfig();
    expect(result.has("xai_multi_agent")).toBe(true);
    expect(result.has("xai_deep_research")).toBe(true);
  });
});
