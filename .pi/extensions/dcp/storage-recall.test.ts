import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "bun:test";
import {
  deleteDurableSessionState,
  getSessionKey,
  saveDurableSessionState,
} from "./storage";
import { searchDcpRecall } from "./recall";
import {
  addBlock,
  cleanupSession,
  getBlocks,
  makeDcpStateEntryPayload,
  restoreDcpStateFromSessionEntries,
} from "./compress";

test("durable DCP state is searchable through dcp_recall", () => {
  const sessionId = `dcp-test-${Date.now()}-${Math.random()}`;
  try {
    saveDurableSessionState({
      version: 1,
      sessionId,
      sessionKey: getSessionKey(sessionId),
      blocks: [
        {
          id: "b1",
          topic: "auth-token-refresh",
          summary:
            "Refresh auth tokens after password reset to prevent stale login sessions.",
          filesRead: ["src/auth/session.ts"],
          filesModified: ["src/auth/session.ts"],
          decisions: [
            "Use refresh-on-reset because stale sessions caused login failures.",
          ],
          nextSteps: ["Run auth regression tests."],
          createdAt: Date.now(),
          source: "test",
        },
      ],
      artifacts: [],
      processedMessageIds: [],
      compressEventCount: 1,
      lastCompressTurn: 1,
      updatedAt: Date.now(),
    });

    const result = searchDcpRecall({ sessionId, query: "stale login" });

    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.rendered).toContain("auth-token-refresh");
    expect(result.rendered).toContain("stale login");

    const expanded = searchDcpRecall({
      sessionId,
      expand: [result.entries[0].index],
    });
    expect(expanded.rendered).toContain("Refresh auth tokens");
  } finally {
    deleteDurableSessionState(sessionId);
  }
});

test("raw JSONL recall filters custom rewind noise and assistant thinking", () => {
  const dir = mkdtempSync(join(tmpdir(), "dcp-recall-"));
  const sessionFile = join(dir, "session.jsonl");
  try {
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "custom",
          customType: "rewind-turn",
          data: { snapshots: ["abc"] },
          timestamp: Date.now(),
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "secret chain of thought" },
            ],
          },
          timestamp: Date.now(),
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "hidden" },
              { type: "text", text: "Visible assistant answer" },
            ],
          },
          timestamp: Date.now(),
        }),
      ].join("\n"),
    );

    const result = searchDcpRecall({
      sessionId: "jsonl-filter-test",
      sessionFile,
    });

    expect(result.rendered).toContain("Visible assistant answer");
    expect(result.rendered).not.toContain("rewind-turn");
    expect(result.rendered).not.toContain("secret chain of thought");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("query mode downranks pasted recall output echoes", () => {
  const dir = mkdtempSync(join(tmpdir(), "dcp-recall-echo-"));
  const sessionFile = join(dir, "session.jsonl");
  try {
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: 'output "/dcp-recall deterministic" - "DCP recall for deterministic: #756 [jsonl:toolResult] deterministic deterministic deterministic"',
              },
            ],
          },
          timestamp: 3,
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "DCP deterministic compaction preserves context without LLM calls.",
              },
            ],
          },
          timestamp: 2,
        }),
      ].join("\n"),
    );

    const result = searchDcpRecall({
      sessionId: "jsonl-echo-test",
      sessionFile,
      query: "deterministic",
    });

    expect(result.entries[0].role).toBe("assistant");
    expect(result.rendered).toContain("preserves context without LLM calls");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("query mode ranks visible conversation above noisy tool output", () => {
  const dir = mkdtempSync(join(tmpdir(), "dcp-recall-rank-"));
  const sessionFile = join(dir, "session.jsonl");
  try {
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "message",
          message: {
            role: "toolResult",
            content: `deterministic ${"deterministic ".repeat(40)}`,
          },
          timestamp: 2,
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "DCP deterministic compaction is now cleaner.",
              },
            ],
          },
          timestamp: 1,
        }),
      ].join("\n"),
    );

    const result = searchDcpRecall({
      sessionId: "jsonl-rank-test",
      sessionFile,
      query: "deterministic",
    });

    expect(result.entries[0].role).toBe("assistant");
    expect(result.rendered).toContain(
      "DCP deterministic compaction is now cleaner",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("browse mode suppresses pasted recall diagnostics", () => {
  const dir = mkdtempSync(join(tmpdir(), "dcp-recall-browse-echo-"));
  const sessionFile = join(dir, "session.jsonl");
  try {
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Brutal review: query mode is still ranking wrong. DCP recall browse: #123 [jsonl:user]",
              },
            ],
          },
          timestamp: 4,
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Yep, still too noisy. Browse mode /dcp-recall should not show tool output.",
              },
            ],
          },
          timestamp: 3,
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: "output /dep-recall deterministic with pasted recall rows",
              },
            ],
          },
          timestamp: 2,
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: [
              { type: "text", text: "Implement branch summarization support" },
            ],
          },
          timestamp: 1,
        }),
      ].join("\n"),
    );

    const browse = searchDcpRecall({
      sessionId: "jsonl-browse-echo-test",
      sessionFile,
    });

    expect(browse.rendered).toContain("Implement branch summarization support");
    expect(browse.rendered).not.toContain("Brutal review");
    expect(browse.rendered).not.toContain("still too noisy");
    expect(browse.rendered).not.toContain("dep-recall");
    expect(browse.entries).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("browse mode suppresses low-signal acknowledgements but query can find them", () => {
  const dir = mkdtempSync(join(tmpdir(), "dcp-recall-ack-"));
  const sessionFile = join(dir, "session.jsonl");
  try {
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: [{ type: "text", text: "ok sure" }],
          },
          timestamp: 4,
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: [{ type: "text", text: "ok go ahead continue next work" }],
          },
          timestamp: 3,
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: "Research Pi compaction and extension docs for DCP integration",
              },
            ],
          },
          timestamp: 2,
        }),
      ].join("\n"),
    );

    const browse = searchDcpRecall({
      sessionId: "jsonl-ack-test",
      sessionFile,
    });
    expect(browse.rendered).toContain("Research Pi compaction");
    expect(browse.rendered).not.toContain("ok sure");
    expect(browse.rendered).not.toContain("ok go ahead continue next work");

    const queried = searchDcpRecall({
      sessionId: "jsonl-ack-test",
      sessionFile,
      query: "go ahead",
    });
    expect(queried.rendered).toContain("ok go ahead continue next work");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("browse mode suppresses recall UX review diagnostics", () => {
  const dir = mkdtempSync(join(tmpdir(), "dcp-recall-ux-review-"));
  const sessionFile = join(dir, "session.jsonl");
  try {
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "This is **clean**, but now it is maybe **too sparse**. Browse mode no longer shows: tool spam, raw JSON, recall-debug loop.",
              },
            ],
          },
          timestamp: 3,
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: "Review all changes relevant to dcp compaction",
              },
            ],
          },
          timestamp: 2,
        }),
      ].join("\n"),
    );

    const browse = searchDcpRecall({
      sessionId: "jsonl-ux-review-test",
      sessionFile,
    });
    expect(browse.rendered).toContain(
      "Review all changes relevant to dcp compaction",
    );
    expect(browse.rendered).not.toContain("too sparse");
    expect(browse.rendered).not.toContain("Browse mode no longer shows");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("browse mode suppresses legacy benchmark diagnostics but query can find them", () => {
  const dir = mkdtempSync(join(tmpdir(), "dcp-recall-benchmark-"));
  const sessionFile = join(dir, "session.jsonl");
  try {
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "This output is good now. benchmark formatting is fixed. Before: 1287350 After: 6851 Reduction: 99.47%",
              },
            ],
          },
          timestamp: 4,
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: "DCP compaction diagnostic benchmark: Session 1 Before tokens: 1287350 After tokens: 6851 Diagnostic only. Normal workflow: /compact and /dcp-recall",
              },
            ],
          },
          timestamp: 3,
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: [
              { type: "text", text: "should we stop use pi-vcc extension" },
            ],
          },
          timestamp: 2,
        }),
      ].join("\n"),
    );

    const browse = searchDcpRecall({
      sessionId: "jsonl-benchmark-test",
      sessionFile,
    });
    expect(browse.rendered).toContain("should we stop use pi-vcc extension");
    expect(browse.rendered).not.toContain(
      "DCP compaction diagnostic benchmark",
    );
    expect(browse.rendered).not.toContain("benchmark formatting is fixed");

    const queried = searchDcpRecall({
      sessionId: "jsonl-benchmark-test",
      sessionFile,
      query: "benchmark",
    });
    expect(queried.rendered).toContain("DCP compaction diagnostic benchmark");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("browse mode suppresses tool-only entries but query mode can find tool output", () => {
  const dir = mkdtempSync(join(tmpdir(), "dcp-recall-tool-"));
  const sessionFile = join(dir, "session.jsonl");
  try {
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", name: "bash" }],
          },
          timestamp: 1,
        }),
        JSON.stringify({
          type: "message",
          message: { role: "toolResult", content: "bun test passed" },
          timestamp: 2,
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: [{ type: "text", text: "continue next work" }],
          },
          timestamp: 3,
        }),
      ].join("\n"),
    );

    const browse = searchDcpRecall({
      sessionId: "jsonl-browse-test",
      sessionFile,
    });
    expect(browse.rendered).toContain("continue next work");
    expect(browse.rendered).not.toContain("tool call: bash");
    expect(browse.rendered).not.toContain("bun test passed");

    const queried = searchDcpRecall({
      sessionId: "jsonl-browse-test",
      sessionFile,
      query: "bun test",
    });
    expect(queried.rendered).toContain("bun test passed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recall display normalizes DCP-specific OCR typos without mutating search storage", () => {
  const dir = mkdtempSync(join(tmpdir(), "dcp-recall-normalize-"));
  const sessionFile = join(dir, "session.jsonl");
  try {
    writeFileSync(
      sessionFile,
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Added dep_state entries. Ran bun build dep/index.ts. Use dop_recall if needed.",
            },
          ],
        },
        timestamp: Date.now(),
      }),
    );

    const browse = searchDcpRecall({
      sessionId: "jsonl-normalize-test",
      sessionFile,
    });
    expect(browse.rendered).toContain("dcp_state");
    expect(browse.rendered).toContain("dcp/index.ts");
    expect(browse.rendered).toContain("dcp_recall");
    expect(browse.rendered).not.toContain("dep_state");
    expect(browse.rendered).not.toContain("dep/index.ts");
    expect(browse.rendered).not.toContain("dop_recall");

    const expanded = searchDcpRecall({
      sessionId: "jsonl-normalize-test",
      sessionFile,
      expand: [browse.entries[0].index],
    });
    expect(expanded.rendered).toContain("dcp_state");
    expect(expanded.rendered).toContain("dcp/index.ts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("DCP state snapshots restore from branch-native custom entries", () => {
  const sourceSession = `dcp-source-${Date.now()}-${Math.random()}`;
  const targetSession = `dcp-target-${Date.now()}-${Math.random()}`;
  try {
    addBlock(
      sourceSession,
      "branch-state",
      "Carry DCP state across tree navigation.",
      "start",
      "end",
      {
        decisions: [
          "Store DCP snapshots in session entries for branch correctness.",
        ],
      },
    );
    const payload = makeDcpStateEntryPayload(sourceSession, "manual");

    const restored = restoreDcpStateFromSessionEntries(targetSession, [
      {
        type: "custom",
        id: "entry-1",
        customType: "dcp_state",
        timestamp: Date.now(),
        data: payload,
      },
    ]);

    expect(restored).toBe(true);
    expect(getBlocks(targetSession).map((block) => block.topic)).toContain(
      "branch-state",
    );
  } finally {
    cleanupSession(sourceSession);
    cleanupSession(targetSession);
    deleteDurableSessionState(sourceSession);
    deleteDurableSessionState(targetSession);
  }
});
