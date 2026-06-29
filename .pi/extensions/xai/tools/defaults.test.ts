import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  XAI_DEFAULT_ENABLED_TOOLS,
  XAI_DEFAULT_DISABLED_TOOLS,
  XAI_ALL_TOOL_NAMES,
  resolveXaiToolConfig,
} from "./defaults";

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
  it("covers all 9 xai tools exactly once between the two lists", () => {
    expect(XAI_ALL_TOOL_NAMES.length).toBe(9);
    const all = new Set(XAI_ALL_TOOL_NAMES);
    expect(all.size).toBe(9);
    for (const t of XAI_DEFAULT_ENABLED_TOOLS) expect(XAI_DEFAULT_DISABLED_TOOLS).not.toContain(t);
  });

  it("returns the 5 default-enabled tools when no env vars are set", () => {
    const result = resolveXaiToolConfig();
    expect(result.size).toBe(XAI_DEFAULT_ENABLED_TOOLS.length);
    for (const t of XAI_DEFAULT_ENABLED_TOOLS) expect(result.has(t)).toBe(true);
    for (const t of XAI_DEFAULT_DISABLED_TOOLS) expect(result.has(t)).toBe(false);
  });

  it("PI_XAI_ENABLE_TOOLS adds tools to the enabled set", () => {
    process.env.PI_XAI_ENABLE_TOOLS = "xai_multi_agent,xai_deep_research";
    const result = resolveXaiToolConfig();
    expect(result.has("xai_multi_agent")).toBe(true);
    expect(result.has("xai_deep_research")).toBe(true);
    // Defaults still on
    expect(result.has("xai_web_search")).toBe(true);
  });

  it("PI_XAI_DISABLE_TOOLS removes tools from the enabled set", () => {
    process.env.PI_XAI_DISABLE_TOOLS = "xai_web_search,xai_x_search";
    const result = resolveXaiToolConfig();
    expect(result.has("xai_web_search")).toBe(false);
    expect(result.has("xai_x_search")).toBe(false);
    // Other defaults still on
    expect(result.has("xai_critique")).toBe(true);
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
