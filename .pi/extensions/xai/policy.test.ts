import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_XAI_SIDE_TOOL_ALLOWLIST,
  XAI_SIDE_TOOL_NAMES,
  isXaiSideTool,
  mergeAgentDisallowedTools,
  parseMergedDisallowedTools,
  parseXaiSideToolAllowlist,
  pruneXaiSideTools,
  xaiSideToolsPruneDisabled,
} from "./policy.js";

describe("xai/policy", () => {
  it("isXaiSideTool", () => {
    assert.equal(isXaiSideTool("xai_web_search"), true);
    assert.equal(isXaiSideTool("Read"), false);
    assert.equal(isXaiSideTool("websearch"), false);
  });

  it("pruneXaiSideTools strips all xai_* by default allowlist", () => {
    const active = ["read", "xai_web_search", "bash", "xai_critique", "Read"];
    const next = pruneXaiSideTools(active, DEFAULT_XAI_SIDE_TOOL_ALLOWLIST);
    assert.deepEqual(next, ["read", "bash", "Read"]);
  });

  it("pruneXaiSideTools honors allowlist", () => {
    const active = ["xai_analyze_image", "xai_web_search"];
    const next = pruneXaiSideTools(active, ["xai_analyze_image"]);
    assert.deepEqual(next, ["xai_analyze_image"]);
  });

  it("parseXaiSideToolAllowlist", () => {
    assert.deepEqual(parseXaiSideToolAllowlist(""), []);
    assert.deepEqual(parseXaiSideToolAllowlist("xai_analyze_image"), ["xai_analyze_image"]);
    assert.deepEqual(parseXaiSideToolAllowlist("read, grep"), []);
  });

  it("parseMergedDisallowedTools appends xai_* when prune enabled", () => {
    const prev = process.env.PI_XAI_SIDE_TOOLS;
    delete process.env.PI_XAI_SIDE_TOOLS;
    try {
      assert.ok(!xaiSideToolsPruneDisabled());
      const merged = parseMergedDisallowedTools("edit, write");
      assert.deepEqual(merged.slice(0, 2), ["edit", "write"]);
      for (const name of XAI_SIDE_TOOL_NAMES) {
        assert.ok(merged.includes(name), `missing ${name}`);
      }
    } finally {
      if (prev === undefined) delete process.env.PI_XAI_SIDE_TOOLS;
      else process.env.PI_XAI_SIDE_TOOLS = prev;
    }
  });

  it("mergeAgentDisallowedTools respects PI_XAI_SIDE_TOOLS=1", () => {
    const prev = process.env.PI_XAI_SIDE_TOOLS;
    process.env.PI_XAI_SIDE_TOOLS = "1";
    try {
      assert.equal(mergeAgentDisallowedTools("edit"), "edit");
      assert.deepEqual(parseMergedDisallowedTools("edit"), ["edit"]);
    } finally {
      if (prev === undefined) delete process.env.PI_XAI_SIDE_TOOLS;
      else process.env.PI_XAI_SIDE_TOOLS = prev;
    }
  });
});