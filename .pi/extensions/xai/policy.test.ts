import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_XAI_SIDE_TOOL_ALLOWLIST,
  XAI_COMPAT_SHIM_MODEL_KEYS,
  XAI_COMPAT_SHIM_TOOL_NAMES,
  XAI_SIDE_TOOL_NAMES,
  isDisallowedXaiToolForModel,
  isXaiCompatShimTool,
  isXaiSideTool,
  mergeAgentDisallowedTools,
  parseMergedDisallowedTools,
  parseXaiSideToolAllowlist,
  pruneXaiCompatShimTools,
  pruneXaiSideTools,
  pruneXaiTools,
  shouldKeepXaiCompatShims,
  xaiSideToolsPruneDisabled,
  xaiToolBlockReason,
} from "./policy.js";

describe("xai/policy", () => {
  it("tool classifiers", () => {
    assert.equal(isXaiSideTool("xai_web_search"), true);
    assert.equal(isXaiSideTool("Read"), false);
    assert.equal(isXaiSideTool("websearch"), false);
    assert.equal(isXaiCompatShimTool("Read"), true);
    assert.equal(isXaiCompatShimTool("Write"), true);
    assert.equal(isXaiCompatShimTool("read"), false);
    assert.equal(isXaiCompatShimTool("xai_web_search"), false);
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

  it("keeps compatibility shims only for approved xai models", () => {
    for (const key of XAI_COMPAT_SHIM_MODEL_KEYS) {
      const [provider, id] = key.split("/");
      assert.equal(shouldKeepXaiCompatShims({ provider, id }), true, key);
    }

    assert.equal(shouldKeepXaiCompatShims({ provider: "openai-codex", id: "gpt-5.5" }), false);
    assert.equal(shouldKeepXaiCompatShims({ provider: "xai-auth", id: "grok-4.20-0309-reasoning" }), false);
  });

  it("pruneXaiCompatShimTools strips shims for non-allowed models", () => {
    const active = ["read", "Read", "Write", "edit", "Shell", "grep"];
    const next = pruneXaiCompatShimTools(active, { provider: "openai-codex", id: "gpt-5.5" });
    assert.deepEqual(next, ["read", "edit", "grep"]);
  });

  it("pruneXaiCompatShimTools keeps shims for approved xai models", () => {
    const active = ["read", ...XAI_COMPAT_SHIM_TOOL_NAMES];
    const next = pruneXaiCompatShimTools(active, { provider: "xai-auth", id: "grok-composer-2.5-fast" });
    assert.deepEqual(next, active);
  });

  it("pruneXaiTools strips both xai_* and shims for non-allowed models", () => {
    const active = ["read", "xai_web_search", "Read", "Write", "bash"];
    const next = pruneXaiTools(active, [], { provider: "openai-codex", id: "gpt-5.5" });
    assert.deepEqual(next, ["read", "bash"]);
  });

  it("pruneXaiTools keeps shims but strips xai_* for approved xai models", () => {
    const active = ["read", "xai_web_search", "Read", "Write", "bash"];
    const next = pruneXaiTools(active, [], { provider: "xai-auth", id: "grok-4.3" });
    assert.deepEqual(next, ["read", "Read", "Write", "bash"]);
  });

  it("parseXaiSideToolAllowlist", () => {
    assert.deepEqual(parseXaiSideToolAllowlist(""), []);
    assert.deepEqual(parseXaiSideToolAllowlist("xai_analyze_image"), ["xai_analyze_image"]);
    assert.deepEqual(parseXaiSideToolAllowlist("read, grep"), []);
  });

  it("isDisallowedXaiToolForModel blocks xai_* side tools outside allowlist", () => {
    const model = { provider: "some-other", id: "model" };
    assert.equal(isDisallowedXaiToolForModel("xai_web_search", [], model), true);
    assert.equal(isDisallowedXaiToolForModel("xai_web_search", ["xai_web_search"], model), false);
    assert.equal(isDisallowedXaiToolForModel("Read", [], model), true);
    assert.equal(isDisallowedXaiToolForModel("bash", [], model), false);
    assert.equal(isDisallowedXaiToolForModel("bash", [], undefined), false);
  });

  it("isDisallowedXaiToolForModel allows shims for approved xai models", () => {
    const model = { provider: "xai-auth", id: "grok-4.3" };
    assert.equal(isDisallowedXaiToolForModel("Read", [], model), false);
    assert.equal(isDisallowedXaiToolForModel("Shell", [], model), false);
    assert.equal(isDisallowedXaiToolForModel("xai_web_search", [], model), true);
    assert.equal(isDisallowedXaiToolForModel("xai_web_search", ["xai_web_search"], model), false);
  });

  it("xaiToolBlockReason returns undefined for allowed tools", () => {
    const model = { provider: "xai-auth", id: "grok-4.3" };
    assert.equal(xaiToolBlockReason("bash", [], model), undefined);
    assert.equal(xaiToolBlockReason("Read", [], model), undefined);
    assert.equal(xaiToolBlockReason("grep", [], model), undefined);
  });

  it("xaiToolBlockReason returns block reason for disallowed xai_* tools", () => {
    const model = { provider: "some-other", id: "model" };
    const reason = xaiToolBlockReason("xai_web_search", [], model);
    assert.ok(reason, "should return a reason");
    assert.ok(reason!.includes("xai_web_search"), "reason includes tool name");
    assert.ok(reason!.includes("PI_XAI_SIDE_TOOL_ALLOWLIST"), "reason mentions allowlist");
  });

  it("xaiToolBlockReason returns block reason for disallowed shim tools", () => {
    const model = { provider: "openai-codex", id: "gpt-5.5" };
    const reason = xaiToolBlockReason("Read", [], model);
    assert.ok(reason, "should return a reason");
    assert.ok(reason!.includes("Read"), "reason includes tool name");
    assert.ok(reason!.includes("openai-codex/gpt-5.5"), "reason includes current model");
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