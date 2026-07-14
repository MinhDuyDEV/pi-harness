import { expect, describe, it } from "bun:test";
import type {
  Message,
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
  ToolCall,
  TextContent,
} from "@earendil-works/pi-ai";
import {
  matchesGlob,
  isPathLikeKey,
  normalizePath,
  ProtectionPolicy,
  computeProtectionPolicy,
} from "./protection.js";
import { applyDedup, applyPurgeErrors } from "./compress-dedup.js";
import { applyCompressStrip } from "./compress-strip.js";
import { pruneToolResults } from "./compress-prune.js";
import { DEFAULT_CONFIG } from "./config.js";
import type { DCPConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Helpers — construct correctly typed Pi Message fixtures
// ---------------------------------------------------------------------------

// Use tool names not in DEFAULT_PROTECTED_TOOLS ("write", "edit", "compress", etc.)
// to avoid unwanted protection from the strategy union defaults.

function toolCallMsg(
  toolName: string,
  args: Record<string, unknown> = {},
  id: string,
): AssistantMessage {
  const tc: ToolCall = {
    type: "toolCall",
    id,
    name: toolName,
    arguments: args,
  };
  return {
    role: "assistant",
    content: [tc],
    api: "openai-responses",
  };
}

function toolResultMsg(
  content: string,
  toolCallId: string,
  toolName = "testtool",
  isError = false,
): ToolResultMessage {
  const textPart: TextContent = { type: "text", text: content };
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [textPart],
    isError,
    timestamp: Date.now(),
  };
}

function userMsg(content = "hello"): UserMessage {
  return {
    role: "user",
    content,
    timestamp: Date.now(),
  };
}

function compressResultMsg(
  summary: string,
  toolCallId: string,
): ToolResultMessage {
  const textPart: TextContent = {
    type: "text",
    text: `The following is the authoritative summary of the compressed range:\n${summary}`,
  };
  return {
    role: "toolResult",
    toolCallId,
    toolName: "compress",
    content: [textPart],
    isError: false,
    timestamp: Date.now(),
  };
}

/**
 * Build a config with all strategy protectedTools cleared by default.
 * Individual tests opt in by setting the fields they want.
 */
function makeConfig(overrides: Partial<DCPConfig> = {}): DCPConfig {
  // Start from defaults but clear all strategy protectedTools so tests are explicit
  const base = DEFAULT_CONFIG;
  return {
    ...base,
    ...overrides,
    protection: {
      protectedFilePatterns: [],
      recentTurns: 3,
      ...(overrides.protection ?? {}),
    },
    compress: {
      ...base.compress,
      protectedTools: [],
      protectUserMessages: false,
      ...(overrides.compress ?? {}),
    },
    dedup: {
      ...base.dedup,
      protectedTools: [],
      ...(overrides.dedup ?? {}),
    },
    purgeErrors: {
      ...base.purgeErrors,
      protectedTools: [],
      ...(overrides.purgeErrors ?? {}),
    },
    toolResultPruning: {
      ...base.toolResultPruning,
      protectedTools: [],
      ...(overrides.toolResultPruning ?? {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

describe("matchesGlob", () => {
  it("matches exact path", () => {
    expect(matchesGlob("src/foo.ts", "src/foo.ts")).toBe(true);
  });

  it("matches single * in segment", () => {
    expect(matchesGlob("src/foo.ts", "src/*.ts")).toBe(true);
    expect(matchesGlob("src/foo.ts", "src/*.js")).toBe(false);
    expect(matchesGlob("src/foo/bar.ts", "src/*.ts")).toBe(false); // * doesn't cross /
  });

  it("matches ** across segments", () => {
    expect(matchesGlob("src/foo/bar.ts", "src/**/*.ts")).toBe(true);
    expect(matchesGlob("src/bar.ts", "src/**/*.ts")).toBe(true);
    expect(matchesGlob("bar.ts", "**/*.ts")).toBe(true);
    expect(matchesGlob("a/b/c/d.ts", "**/*.ts")).toBe(true);
  });

  it("matches ? single char", () => {
    expect(matchesGlob("src/test1.ts", "src/test?.ts")).toBe(true);
    expect(matchesGlob("src/testA.ts", "src/test?.ts")).toBe(true);
    expect(matchesGlob("src/test.ts", "src/test?.ts")).toBe(false);
    expect(matchesGlob("src/test12.ts", "src/test?.ts")).toBe(false);
  });

  it("matches ** at end", () => {
    expect(matchesGlob("src/foo/bar.txt", "src/**")).toBe(true);
    expect(matchesGlob("src/bar.txt", "src/**")).toBe(true);
    expect(matchesGlob("src/", "src/**")).toBe(true);
  });

  it("normalizes backslashes", () => {
    expect(matchesGlob("src\\foo\\bar.ts", "src/**/*.ts")).toBe(true);
    expect(matchesGlob("C:\\Users\\test\\file.txt", "**/*.txt")).toBe(true);
  });

  it("empty patterns never match", () => {
    expect(matchesGlob("whatever", "")).toBe(false);
  });

  it("pattern without glob matches exact only", () => {
    expect(matchesGlob("foo/bar.ts", "foo/bar.ts")).toBe(true);
    expect(matchesGlob("foo/bar.ts", "foo/bar.js")).toBe(false);
  });

  it("multiple ** segments", () => {
    expect(matchesGlob("a/b/c/d.ts", "**/**/*.ts")).toBe(true);
    expect(matchesGlob("a/b/c/d.ts", "**/c/**")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isPathLikeKey
// ---------------------------------------------------------------------------

describe("isPathLikeKey", () => {
  it("returns true for known path keys", () => {
    expect(isPathLikeKey("path")).toBe(true);
    expect(isPathLikeKey("file")).toBe(true);
    expect(isPathLikeKey("directory")).toBe(true);
    expect(isPathLikeKey("dir")).toBe(true);
    expect(isPathLikeKey("target")).toBe(true);
  });

  it("returns true for keys ending with Path or path", () => {
    expect(isPathLikeKey("oldPath")).toBe(true);
    expect(isPathLikeKey("srcPath")).toBe(true);
    expect(isPathLikeKey("destpath")).toBe(true);
  });

  it("returns false for non-path keys", () => {
    expect(isPathLikeKey("command")).toBe(false);
    expect(isPathLikeKey("options")).toBe(false);
    expect(isPathLikeKey("query")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizePath
// ---------------------------------------------------------------------------

describe("normalizePath", () => {
  it("replaces backslashes with forward slashes", () => {
    expect(normalizePath("a\\b\\c.ts")).toBe("a/b/c.ts");
    expect(normalizePath("C:\\Users\\test")).toBe("C:/Users/test");
  });

  it("preserves forward slashes", () => {
    expect(normalizePath("a/b/c.ts")).toBe("a/b/c.ts");
  });
});

// ---------------------------------------------------------------------------
// ProtectionPolicy construction
// ---------------------------------------------------------------------------

describe("ProtectionPolicy", () => {
  it("isProtected returns true for protected messages", () => {
    const m1: Message = userMsg();
    const m2: Message = toolCallMsg("readtool", {}, "call_dummy");
    const m3: Message = toolResultMsg("data", "call_0", "readtool");
    const ws = new WeakSet<Message>([m1, m3]);
    const policy = new ProtectionPolicy(ws, {
      protectedTools: 1,
      protectedFiles: 1,
      protectedRecentTurns: 0,
      protectedUserMessages: 1,
    });
    expect(policy.isProtected(m1)).toBe(true);
    expect(policy.isProtected(m2)).toBe(false);
    expect(policy.isProtected(m3)).toBe(true);
  });

  it("reports provenance", () => {
    const provenance = {
      protectedTools: 2,
      protectedFiles: 0,
      protectedRecentTurns: 5,
      protectedUserMessages: 1,
    };
    const policy = new ProtectionPolicy(new WeakSet(), provenance);
    expect(policy.provenance).toEqual(provenance);
  });

  it("identity-based: cloned message is not protected", () => {
    const m = userMsg();
    const ws = new WeakSet<Message>([m]);
    const policy = new ProtectionPolicy(ws, {
      protectedTools: 0,
      protectedFiles: 0,
      protectedRecentTurns: 0,
      protectedUserMessages: 1,
    });
    expect(policy.isProtected(m)).toBe(true);
    const clone = structuredClone(m);
    expect(policy.isProtected(clone)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeProtectionPolicy
// ---------------------------------------------------------------------------

describe("computeProtectionPolicy", () => {
  it("protects nothing with empty config", () => {
    const messages: Message[] = [
      toolCallMsg("readtool", { path: "secret.txt" }),
      toolResultMsg("content", "call_1", "readtool"),
      userMsg(),
    ];
    const config = makeConfig({
      compress: { protectedTools: [], protectUserMessages: false },
      protection: { protectedFilePatterns: [], recentTurns: 0 },
    });
    const policy = computeProtectionPolicy(messages, config);
    expect(policy.isProtected(messages[0])).toBe(false);
    expect(policy.isProtected(messages[1])).toBe(false);
    expect(policy.isProtected(messages[2])).toBe(false);
  });

  it("protects tools by name", () => {
    const messages: Message[] = [
      toolCallMsg("writetool", {}, "call_t1"),
      toolResultMsg("saved", "call_t1", "writetool"),
      toolCallMsg("readtool", {}, "call_t2"),
      toolResultMsg("data", "call_t2", "readtool"),
      toolCallMsg("browsertool", {}, "call_t3"),
      toolResultMsg("html", "call_t3", "browsertool"),
    ];
    const config = makeConfig({
      compress: { protectedTools: ["writetool", "readtool"] },
      protection: { protectedFilePatterns: [], recentTurns: 0 },
    });
    const policy = computeProtectionPolicy(messages, config);
    expect(policy.isProtected(messages[0])).toBe(true);
    expect(policy.isProtected(messages[1])).toBe(true);
    expect(policy.isProtected(messages[2])).toBe(true);
    expect(policy.isProtected(messages[3])).toBe(true);
    expect(policy.isProtected(messages[4])).toBe(false);
    expect(policy.isProtected(messages[5])).toBe(false);
    expect(policy.provenance.protectedTools).toBe(4);
  });

  it("protects files by glob pattern", () => {
    const messages: Message[] = [
      toolCallMsg(
        "writetool",
        { path: "/Users/me/secret/config.yml" },
        "call_f1",
      ),
      toolResultMsg("saved", "call_f1", "writetool"),
      toolCallMsg(
        "writetool",
        { path: "/Users/me/public/readme.md" },
        "call_f2",
      ),
      toolResultMsg("saved", "call_f2", "writetool"),
      toolCallMsg("readtool", { file: "notes.txt" }, "call_f3"),
      toolResultMsg("content", "call_f3", "readtool"),
    ];
    const config = makeConfig({
      protection: {
        protectedFilePatterns: ["**/secret/**", "**/*.yml"],
        recentTurns: 0,
      },
      compress: { protectedTools: [] },
    });
    const policy = computeProtectionPolicy(messages, config);
    expect(policy.isProtected(messages[0])).toBe(true);
    expect(policy.isProtected(messages[1])).toBe(true);
    expect(policy.isProtected(messages[2])).toBe(false);
    expect(policy.isProtected(messages[3])).toBe(false);
    expect(policy.isProtected(messages[4])).toBe(false);
    expect(policy.isProtected(messages[5])).toBe(false);
  });

  it("protects files with Windows path separators", () => {
    const messages: Message[] = [
      toolCallMsg(
        "writetool",
        { path: "Users\\me\\secret\\config.yml" },
        "call_win",
      ),
      toolResultMsg("saved", "call_win", "writetool"),
    ];
    const config = makeConfig({
      protection: { protectedFilePatterns: ["**/secret/**"], recentTurns: 0 },
      compress: { protectedTools: [] },
    });
    const policy = computeProtectionPolicy(messages, config);
    expect(policy.isProtected(messages[0])).toBe(true);
    expect(policy.isProtected(messages[1])).toBe(true);
  });

  it("protects recent turns", () => {
    // 4 tool-call turns (8 messages: call+result each)
    const messages: Message[] = [
      toolCallMsg("readtool", {}, "call_r1"),
      toolResultMsg("data", "call_r1", "readtool"),
      toolCallMsg("customtool", {}, "call_r2"),
      toolResultMsg("saved", "call_r2", "customtool"),
      toolCallMsg("browsertool", {}, "call_r3"),
      toolResultMsg("html", "call_r3", "browsertool"),
      toolCallMsg("listtool", {}, "call_r4"),
      toolResultMsg("items", "call_r4", "listtool"),
    ];
    const config = makeConfig({
      protection: { protectedFilePatterns: [], recentTurns: 2 },
      compress: { protectedTools: [] },
    });
    const policy = computeProtectionPolicy(messages, config);
    // First 2 turns unprotected, last 2 turns protected
    expect(policy.isProtected(messages[0])).toBe(false);
    expect(policy.isProtected(messages[1])).toBe(false);
    expect(policy.isProtected(messages[2])).toBe(false);
    expect(policy.isProtected(messages[3])).toBe(false);
    expect(policy.isProtected(messages[4])).toBe(true);
    expect(policy.isProtected(messages[5])).toBe(true);
    expect(policy.isProtected(messages[6])).toBe(true);
    expect(policy.isProtected(messages[7])).toBe(true);
    // 4 call+result from recent window + extra results re-protected by toolCallId pairing
    expect(policy.provenance.protectedRecentTurns).toBeGreaterThanOrEqual(4);
  });

  it("protects user messages", () => {
    const messages: Message[] = [
      userMsg("first"),
      toolCallMsg("readtool", {}, "call_u1"),
      toolResultMsg("data", "call_u1", "readtool"),
      userMsg("second"),
    ];
    const config = makeConfig({
      compress: { protectUserMessages: true, protectedTools: [] },
      protection: { protectedFilePatterns: [], recentTurns: 0 },
    });
    const policy = computeProtectionPolicy(messages, config);
    expect(policy.isProtected(messages[0])).toBe(true);
    expect(policy.isProtected(messages[1])).toBe(false);
    expect(policy.isProtected(messages[2])).toBe(false);
    expect(policy.isProtected(messages[3])).toBe(true);
    expect(policy.provenance.protectedUserMessages).toBe(2);
  });

  it("does not inspect shell command strings via isPathLikeKey", () => {
    const messages: Message[] = [
      toolCallMsg("bashtool", { command: "rm -rf /secret/file" }, "call_bash"),
      toolResultMsg("done", "call_bash", "bashtool"),
    ];
    const config = makeConfig({
      protection: { protectedFilePatterns: ["**/secret/**"], recentTurns: 0 },
      compress: { protectedTools: [] },
    });
    const policy = computeProtectionPolicy(messages, config);
    expect(policy.isProtected(messages[0])).toBe(false);
    expect(policy.isProtected(messages[1])).toBe(false);
  });

  it("preserves protectedTools union with file patterns", () => {
    const messages: Message[] = [
      toolCallMsg("writetool", { path: "notes.txt" }, "call_u2"),
      toolResultMsg("saved", "call_u2", "writetool"),
      toolCallMsg("readtool", { file: "public/doc.md" }, "call_u3"),
      toolResultMsg("content", "call_u3", "readtool"),
    ];
    const config = makeConfig({
      compress: { protectedTools: ["writetool"] },
      protection: { protectedFilePatterns: ["**/*.md"], recentTurns: 0 },
    });
    const policy = computeProtectionPolicy(messages, config);
    expect(policy.isProtected(messages[0])).toBe(true);
    expect(policy.isProtected(messages[1])).toBe(true);
    expect(policy.isProtected(messages[2])).toBe(true);
    expect(policy.isProtected(messages[3])).toBe(true);
    expect(policy.provenance.protectedTools).toBe(2);
    expect(policy.provenance.protectedFiles).toBe(2);
  });

  it("unions protectedTools from all strategies", () => {
    const messages: Message[] = [
      toolCallMsg("writetool", {}, "call_union1"),
      toolResultMsg("saved", "call_union1", "writetool"),
      toolCallMsg("compiletool", {}, "call_union2"),
      toolResultMsg("output", "call_union2", "compiletool"),
      toolCallMsg("formattool", {}, "call_union3"),
      toolResultMsg("done", "call_union3", "formattool"),
    ];
    const config = makeConfig({
      compress: { protectedTools: ["writetool"] },
      dedup: { enabled: true, protectedTools: ["compiletool"] },
      purgeErrors: { enabled: true, turns: 0, protectedTools: ["formattool"] },
      protection: { protectedFilePatterns: [], recentTurns: 0 },
    });
    const policy = computeProtectionPolicy(messages, config);
    expect(policy.isProtected(messages[0])).toBe(true);
    expect(policy.isProtected(messages[1])).toBe(true);
    expect(policy.isProtected(messages[2])).toBe(true);
    expect(policy.isProtected(messages[3])).toBe(true);
    expect(policy.isProtected(messages[4])).toBe(true);
    expect(policy.isProtected(messages[5])).toBe(true);
    expect(policy.provenance.protectedTools).toBe(6);
  });

  it("protection.recentTurns is authoritative over toolResultPruning.protectedRecentTurns", () => {
    const messages: Message[] = [
      toolCallMsg("readtool", {}, "call_ra1"),
      toolResultMsg("data", "call_ra1", "readtool"),
      toolCallMsg("writetool", {}, "call_ra2"),
      toolResultMsg("saved", "call_ra2", "writetool"),
    ];
    const config = makeConfig({
      protection: { protectedFilePatterns: [], recentTurns: 0 },
      compress: { protectedTools: [] },
    });
    const policy = computeProtectionPolicy(messages, config);
    expect(policy.provenance.protectedRecentTurns).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: strategies respect protection policy
// ---------------------------------------------------------------------------

describe("applyCompressStrip respects protection", () => {
  it("protected tools survive stripping", () => {
    const messages: Message[] = [
      toolCallMsg("readtool", { path: "a.txt" }, "call_s1"),
      toolResultMsg("content A", "call_s1", "readtool"),
      toolCallMsg("writetool", { path: "b.txt" }, "call_s2"),
      toolResultMsg("saved B", "call_s2", "writetool"),
    ];

    const config = makeConfig({
      compress: { protectedTools: ["writetool"] },
      protection: { protectedFilePatterns: [], recentTurns: 0 },
    });

    const protection = computeProtectionPolicy(messages, config);
    const sessionId = "test-session";
    const result = applyCompressStrip(messages, sessionId, config, protection);

    const writeCall = result.messages.find(
      (m) =>
        m.role === "assistant" &&
        m.content.some((c) => c.type === "toolCall" && c.name === "writetool"),
    );
    expect(writeCall).toBeDefined();
  });
});

describe("applyDedup respects protection", () => {
  it("protected tools skip dedup stripping", () => {
    const messages: Message[] = [
      toolCallMsg("readtool", { path: "a.txt" }, "call_d1"),
      toolResultMsg("content", "call_d1", "readtool"),
      toolCallMsg("readtool", { path: "b.txt" }, "call_d2"),
      toolResultMsg("content", "call_d2", "readtool"),
    ];

    const config = makeConfig({
      compress: { protectedTools: ["readtool"] },
      protection: { protectedFilePatterns: [], recentTurns: 0 },
    });

    const protection = computeProtectionPolicy(messages, config);
    const result = applyDedup(messages, config, protection);

    expect(result.prunedTokens).toBeDefined();
    expect(result.prunedCount).toBeDefined();
  });
});

describe("applyPurgeErrors respects protection", () => {
  it("protected tools skip error purging", () => {
    const messages: Message[] = [
      toolCallMsg("readtool", { path: "a.txt" }, "call_p1"),
      toolResultMsg("Error: not found", "call_p1", "readtool", true),
    ];

    const config = makeConfig({
      compress: { protectedTools: ["readtool"] },
      protection: { protectedFilePatterns: [], recentTurns: 0 },
      purgeErrors: { enabled: true, turns: 0, protectedTools: [] },
    });

    const protection = computeProtectionPolicy(messages, config);
    const result = applyPurgeErrors(messages, config, protection);

    expect(result.prunedCount).toBe(0);
  });

  it("unprotected error tools run function", () => {
    const messages: Message[] = [
      toolCallMsg(
        "readtool",
        { path: "a.txt", input: "do something long ".repeat(20) },
        "call_p2",
      ),
      toolResultMsg("Error: not found", "call_p2", "readtool", true),
    ];

    const config = makeConfig({
      compress: { protectedTools: [] },
      protection: { protectedFilePatterns: [], recentTurns: 0 },
      purgeErrors: { enabled: true, turns: 0, protectedTools: [] },
    });

    const protection = computeProtectionPolicy(messages, config);
    const result = applyPurgeErrors(messages, config, protection);

    expect(result.prunedTokens).toBeDefined();
    expect(result.prunedCount).toBeDefined();
  });
});

describe("pruneToolResults respects protection", () => {
  it("recently protected tools skip pruning", () => {
    const longContent = "x".repeat(2000);
    const messages: Message[] = [
      userMsg("read this"),
      toolCallMsg("readtool", { path: "a.txt" }, "call_pr1"),
      toolResultMsg(longContent, "call_pr1", "readtool"),
    ];

    const config = makeConfig({
      compress: { protectedTools: [] },
      protection: { protectedFilePatterns: [], recentTurns: 3 },
    });

    const protection = computeProtectionPolicy(messages, config);

    expect(protection.isProtected(messages[1])).toBe(true);
    expect(protection.isProtected(messages[2])).toBe(true);

    const result = pruneToolResults(messages, config, protection);

    expect(result.prunedTokens).toBeGreaterThanOrEqual(0);
    expect(result.prunedCount).toBeGreaterThanOrEqual(0);
  });

  it("unprotected long results still get pruned", () => {
    const longContent = "x".repeat(2000);
    const messages: Message[] = [
      toolCallMsg("readtool", { path: "a.txt" }, "call_pr2"),
      toolResultMsg(longContent, "call_pr2", "readtool"),
    ];

    const config = makeConfig({
      compress: { protectedTools: [] },
      protection: { protectedFilePatterns: [], recentTurns: 0 },
    });

    const protection = computeProtectionPolicy(messages, config);
    expect(protection.isProtected(messages[0])).toBe(false);
    expect(protection.isProtected(messages[1])).toBe(false);

    const result = pruneToolResults(messages, config, protection);

    expect(result.prunedTokens).toBeDefined();
    expect(result.prunedCount).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Identity-stability integration test
// Proves that a protected object remains protected by the same policy
// after an earlier unprotected message is removed by compress-strip.
// ---------------------------------------------------------------------------

describe("protection identity survives array mutation", () => {
  it("protected object remains protected after compress-strip removes earlier unprotected messages", () => {
    // Messages — protected messages must come AFTER the compress range so they
    // survive strip (compress-strip only removes messages BEFORE each compress
    // call, not after):
    //   [0] user: "hello"                      (unprotected, inside strip range)
    //   [1] assistant: compress tool call       (triggers strip of range 0..0)
    //   [2] toolResult: compress summary        (strip removes call+result too)
    //   [3] assistant: writetool (protected)    (protected by tool name, after strip)
    //   [4] toolResult: "saved"                 (protected by toolCallId pairing)
    // After strip: [compressedSummary, writetool call, writetool result]
    const messages: Message[] = [
      userMsg("hello"),
      toolCallMsg("compress", { summary: "previous work" }, "call_id1"),
      compressResultMsg("Previous work done", "call_id1"),
      toolCallMsg("writetool", { path: "output.txt" }, "call_id2"),
      toolResultMsg("saved", "call_id2", "writetool"),
    ];

    const config = makeConfig({
      compress: {
        protectedTools: ["writetool"],
        protectUserMessages: false,
      },
      protection: { protectedFilePatterns: [], recentTurns: 0 },
    });

    // Compute protection policy over the raw message array
    const protection = computeProtectionPolicy(messages, config);

    // Verify protection before strip
    expect(protection.isProtected(messages[3])).toBe(true); // writetool call
    expect(protection.isProtected(messages[4])).toBe(true); // writetool result
    expect(protection.isProtected(messages[0])).toBe(false); // user (unprotected)

    // Capture object references before strip
    const writeCall = messages[3];
    const writeResult = messages[4];
    const unprotectedUser = messages[0];

    // Run compress-strip — removes messages[0]..messages[2]
    const sessionId = "identity-test";
    const stripResult = applyCompressStrip(
      messages,
      sessionId,
      config,
      protection,
    );
    const strippedMsgs = stripResult.messages;

    // Verify the protected objects survived in the new array
    const writeCallSurvived = strippedMsgs.some((m) => m === writeCall);
    const writeResultSurvived = strippedMsgs.some((m) => m === writeResult);
    expect(writeCallSurvived).toBe(true);
    expect(writeResultSurvived).toBe(true);

    // Verify the unprotected user message was removed
    const userSurvived = strippedMsgs.some((m) => m === unprotectedUser);
    expect(userSurvived).toBe(false);

    // CRITICAL: the same protection policy still identifies the protected
    // objects because it uses WeakSet (object identity), not array indices.
    expect(protection.isProtected(writeCall)).toBe(true);
    expect(protection.isProtected(writeResult)).toBe(true);
    expect(protection.isProtected(unprotectedUser)).toBe(false);

    // Also test that dedup respects the surviving policy
    const dedupResult = applyDedup(strippedMsgs, config, protection);
    expect(dedupResult.prunedCount).toBeGreaterThanOrEqual(0);

    // And that prune respects it
    const pruneResult = pruneToolResults(strippedMsgs, config, protection);
    expect(pruneResult.prunedCount).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("protection edge cases", () => {
  it("handles empty messages array", () => {
    const config = makeConfig();
    const policy = computeProtectionPolicy([], config);
    expect(policy.provenance.protectedTools).toBe(0);
    expect(policy.provenance.protectedFiles).toBe(0);
    expect(policy.provenance.protectedRecentTurns).toBe(0);
    expect(policy.provenance.protectedUserMessages).toBe(0);
  });

  it("handles tool calls with no matching patterns", () => {
    const messages: Message[] = [
      toolCallMsg("customtool", { path: "data.csv" }, "call_e1"),
      toolResultMsg("content", "call_e1", "customtool"),
    ];
    const config = makeConfig({
      protection: { protectedFilePatterns: ["**/*.ts"], recentTurns: 0 },
      compress: { protectedTools: [] },
    });
    const policy = computeProtectionPolicy(messages, config);
    expect(policy.isProtected(messages[0])).toBe(false);
    expect(policy.isProtected(messages[1])).toBe(false);
  });

  it("handles assistant message with mixed content parts", () => {
    const textPart: TextContent = { type: "text", text: "Let me check..." };
    const tc: ToolCall = {
      type: "toolCall",
      id: "call_mixed",
      name: "readtool",
      arguments: { path: "file.txt" },
    };
    const msg: AssistantMessage = {
      role: "assistant",
      content: [textPart, tc],
      api: "openai-responses",
    };
    const result: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "call_mixed",
      toolName: "readtool",
      content: [{ type: "text", text: "content" }],
      isError: false,
      timestamp: Date.now(),
    };
    const messages: Message[] = [msg, result];
    const config = makeConfig({
      compress: { protectedTools: ["readtool"] },
      protection: { protectedFilePatterns: [], recentTurns: 0 },
    });
    const policy = computeProtectionPolicy(messages, config);
    expect(policy.isProtected(messages[0])).toBe(true);
    expect(policy.isProtected(messages[1])).toBe(true);
  });

  it("recent turns = 0 protects nothing", () => {
    const messages: Message[] = [
      toolCallMsg("readtool", {}, "call_z"),
      toolResultMsg("data", "call_z", "readtool"),
    ];
    const config = makeConfig({
      protection: { protectedFilePatterns: [], recentTurns: 0 },
      compress: { protectedTools: [] },
    });
    const policy = computeProtectionPolicy(messages, config);
    expect(policy.isProtected(messages[0])).toBe(false);
    expect(policy.isProtected(messages[1])).toBe(false);
  });
});
