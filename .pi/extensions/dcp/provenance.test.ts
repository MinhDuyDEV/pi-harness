import { describe, it, expect, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import type { DcpProvenanceV2, CompressionBlock } from "./compress-types.ts";
import {
  captureProvenance,
  validateBlockProvenance,
  addBlock,
  getBlocks,
  getQuarantinedBlocks,
  getProvenanceCounts,
  isLegacyBlock,
  validateBlocksProvenance,
  cleanupSession,
} from "./compress-state.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock session handle with the given branch entries.
 */
function mockSession(opts: {
  sessionId?: string;
  leafId?: string | null;
  branchIds?: string[];
}) {
  const sessionId = opts.sessionId ?? "test-session";
  const leafId = opts.leafId ?? null;
  const branchIds = opts.branchIds ?? [];
  const entries = branchIds.map((id) => ({ id }));

  return {
    getSessionId: () => sessionId,
    getLeafId: () => leafId,
    getBranch: () => entries,
  };
}

function fakeProvenance(
  overrides: Partial<DcpProvenanceV2> & { coveredEntryIds: string[] },
): DcpProvenanceV2 {
  return {
    version: 2,
    sessionId: "test-session",
    leafId: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

// Remove durable state file from disk so getState creates fresh in-memory state
function freshSessionId(): string {
  return `prov-test-${randomUUID()}`;
}

// Clean up the durable state file so it doesn't affect other tests
function cleanupDurableSession(sessionId: string): void {
  const stateDir = join(homedir(), ".pi", "extensions", "dcp", "sessions");
  // The state file name is derived from the session ID hash
  const hash = createHash("sha256").update(sessionId).digest("hex");
  const statePath = join(stateDir, `${hash}.json`);
  try {
    if (existsSync(statePath)) rmSync(statePath);
  } catch {
    // Ignore
  }
  cleanupSession(sessionId);
}

// Auto-cleanup state after each test that creates blocks
function createTestSession(): string {
  const sid = freshSessionId();
  afterAll(() => cleanupDurableSession(sid));
  return sid;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("captureProvenance", () => {
  it("captures session ID, leaf ID, covered entry IDs, and timestamp", () => {
    const session = mockSession({
      sessionId: "s1",
      leafId: "entry-5",
      branchIds: ["entry-1", "entry-2", "entry-3", "entry-4", "entry-5"],
    });

    const prov = captureProvenance(session, 1000, undefined, "test");

    expect(prov.version).toBe(2);
    expect(prov.sessionId).toBe("s1");
    expect(prov.leafId).toBe("entry-5");
    expect(prov.coveredEntryIds).toEqual([
      "entry-1",
      "entry-2",
      "entry-3",
      "entry-4",
      "entry-5",
    ]);
    expect(prov.createdAt).toBe(1000);
    expect(prov.summarySource).toBe("test");
  });

  it("captures protection provenance when provided", () => {
    const session = mockSession({
      sessionId: "s1",
      leafId: "entry-3",
      branchIds: ["entry-1", "entry-2", "entry-3"],
    });

    const pp = {
      protectedTools: 2,
      protectedFiles: 1,
      protectedRecentTurns: 0,
      protectedUserMessages: 3,
    };

    const prov = captureProvenance(session, 2000, pp, "auto");

    expect(prov.protectionProvenance).toEqual(pp);
    expect(prov.summarySource).toBe("auto");
  });
});

describe("validateBlockProvenance", () => {
  it("passes when session and all covered entries match the current branch", () => {
    const session = mockSession({
      sessionId: "s1",
      leafId: "entry-5",
      branchIds: ["entry-1", "entry-2", "entry-3", "entry-4", "entry-5"],
    });

    const prov = fakeProvenance({
      sessionId: "s1",
      leafId: "entry-5",
      coveredEntryIds: ["entry-3", "entry-4", "entry-5"],
    });

    const result = validateBlockProvenance(prov, session);
    expect(result).toEqual({ valid: true });
  });

  it("passes when branch has additional descendant entries (descendant extension)", () => {
    // Block was created when branch had [1,2,3,4,5]
    // Current branch has [1,2,3,4,5,6,7] (descendant extension)
    const session = mockSession({
      sessionId: "s1",
      leafId: "entry-8",
      branchIds: [
        "entry-1",
        "entry-2",
        "entry-3",
        "entry-4",
        "entry-5",
        "entry-6",
        "entry-7",
        "entry-8",
      ],
    });

    const prov = fakeProvenance({
      sessionId: "s1",
      leafId: "entry-5",
      coveredEntryIds: ["entry-3", "entry-4", "entry-5"],
    });

    const result = validateBlockProvenance(prov, session);
    expect(result).toEqual({ valid: true });
  });

  it("quarantines on session mismatch", () => {
    const session = mockSession({
      sessionId: "different-session",
      branchIds: ["entry-1", "entry-2", "entry-3"],
    });

    const prov = fakeProvenance({
      sessionId: "original-session",
      leafId: "entry-3",
      coveredEntryIds: ["entry-1", "entry-2", "entry-3"],
    });

    const result = validateBlockProvenance(prov, session);
    expect(result).toEqual({
      valid: false,
      reason: expect.stringContaining("Session mismatch"),
    });
  });

  it("quarantines when a covered entry is not in the current branch (fork)", () => {
    const session = mockSession({
      sessionId: "s1",
      leafId: "entry-5p",
      branchIds: ["entry-1", "entry-2", "entry-3p", "entry-4p", "entry-5p"],
    });

    const prov = fakeProvenance({
      sessionId: "s1",
      leafId: "entry-5",
      coveredEntryIds: ["entry-1", "entry-2", "entry-3"],
    });

    const result = validateBlockProvenance(prov, session);
    expect(result).toEqual({
      valid: false,
      reason: expect.stringContaining("entry-3"),
    });
  });

  it("quarantines when the creation leaf is not reachable (fork before leaf)", () => {
    const session = mockSession({
      sessionId: "s1",
      leafId: "entry-6",
      branchIds: ["entry-1", "entry-2", "entry-3", "entry-4", "entry-6"],
    });

    const prov = fakeProvenance({
      sessionId: "s1",
      leafId: "entry-5",
      coveredEntryIds: ["entry-1", "entry-2", "entry-3", "entry-4"],
    });

    const result = validateBlockProvenance(prov, session);
    expect(result).toEqual({
      valid: false,
      reason: expect.stringContaining("entry-5"),
    });
  });

  it("skips leaf check when leafId is null (empty session)", () => {
    const session = mockSession({
      sessionId: "s1",
      leafId: "entry-3",
      branchIds: ["entry-1", "entry-2", "entry-3"],
    });

    const prov = fakeProvenance({
      sessionId: "s1",
      leafId: null,
      coveredEntryIds: [],
    });

    const result = validateBlockProvenance(prov, session);
    expect(result).toEqual({ valid: true });
  });
});

describe("validateBlocksProvenance (integration)", () => {
  it("moves invalid blocks to quarantine and keeps valid blocks active", () => {
    const sid = freshSessionId();

    const session = mockSession({
      sessionId: sid,
      leafId: "entry-5",
      branchIds: ["entry-1", "entry-2", "entry-3", "entry-4", "entry-5"],
    });

    // Add a valid block (with matching provenance)
    addBlock(
      sid,
      "valid",
      "Valid block summary",
      "label",
      "label",
      undefined,
      fakeProvenance({
        sessionId: sid,
        leafId: "entry-5",
        coveredEntryIds: ["entry-3", "entry-4", "entry-5"],
      }),
    );

    // Add an invalid block (session mismatch)
    addBlock(
      sid,
      "mismatch",
      "Mismatch block summary",
      "label",
      "label",
      undefined,
      fakeProvenance({
        sessionId: "other-session",
        leafId: "entry-5",
        coveredEntryIds: ["entry-3", "entry-4", "entry-5"],
      }),
    );

    // Add a legacy block (no provenance)
    addBlock(sid, "legacy", "Legacy block summary", "label", "label");

    // Validate
    const quarantined = validateBlocksProvenance(sid, session);
    expect(quarantined).toBe(1); // Only the mismatch block

    const blocks = getBlocks(sid);
    expect(blocks.length).toBe(2); // valid + legacy
    expect(blocks.map((b) => b.topic)).toEqual(["valid", "legacy"]);

    const quarantineBlocks = getQuarantinedBlocks(sid);
    expect(quarantineBlocks.length).toBe(1);
    expect(quarantineBlocks[0].reason).toContain("Session mismatch");

    // Check counts
    const counts = getProvenanceCounts(sid);
    expect(counts.validated).toBe(1);
    expect(counts.legacyUnverified).toBe(1);
    expect(counts.quarantined).toBe(1);

    cleanupDurableSession(sid);
  });
});

describe("getProvenanceCounts", () => {
  it("handles empty state", () => {
    const sid = freshSessionId();
    addBlock(
      sid,
      "v",
      "v",
      "l",
      "l",
      undefined,
      fakeProvenance({
        sessionId: sid,
        leafId: null,
        coveredEntryIds: [],
      }),
    );
    addBlock(sid, "l", "l", "l", "l");

    const counts = getProvenanceCounts(sid);
    expect(counts.validated).toBe(1);
    expect(counts.legacyUnverified).toBe(1);
    expect(counts.quarantined).toBe(0);

    cleanupDurableSession(sid);
  });
});

describe("isLegacyBlock", () => {
  it("returns true for blocks without provenance", () => {
    const block: CompressionBlock = {
      blockId: 1,
      topic: "test",
      summary: "test summary",
      startLabel: "start",
      endLabel: "end",
      summaryTokens: 10,
      createdAt: Date.now(),
    };
    expect(isLegacyBlock(block)).toBe(true);
  });

  it("returns false for blocks with provenance", () => {
    const block: CompressionBlock = {
      blockId: 1,
      topic: "test",
      summary: "test summary",
      startLabel: "start",
      endLabel: "end",
      summaryTokens: 10,
      createdAt: Date.now(),
      provenance: fakeProvenance({
        sessionId: "s1",
        leafId: "entry-1",
        coveredEntryIds: [],
      }),
    };
    expect(isLegacyBlock(block)).toBe(false);
  });
});

describe("addBlock with provenance", () => {
  it("stores provenance on the block and retrieves it", () => {
    const sid = freshSessionId();
    const prov = fakeProvenance({
      sessionId: sid,
      leafId: "entry-3",
      coveredEntryIds: ["entry-1", "entry-2", "entry-3"],
    });

    const block = addBlock(
      sid,
      "provenance-test",
      "Provenance stored",
      "start",
      "end",
      undefined,
      prov,
    );

    expect(block.provenance).toBeDefined();
    expect(block.provenance!.sessionId).toBe(sid);
    expect(block.provenance!.coveredEntryIds).toEqual([
      "entry-1",
      "entry-2",
      "entry-3",
    ]);

    cleanupDurableSession(sid);
  });
});

describe("quarantine round-trip", () => {
  it("quarantined blocks have meaningful fields", () => {
    const sid = freshSessionId();
    const session = mockSession({
      sessionId: sid,
      branchIds: ["entry-1", "entry-2", "entry-3"],
    });

    addBlock(
      sid,
      "bad",
      "This should be quarantined",
      "l",
      "l",
      undefined,
      fakeProvenance({
        sessionId: "wrong-session",
        leafId: "entry-3",
        coveredEntryIds: ["entry-1"],
      }),
    );

    validateBlocksProvenance(sid, session);
    const quarantined = getQuarantinedBlocks(sid);
    expect(quarantined.length).toBe(1);
    const q = quarantined[0];
    expect(q.id).toBeDefined();
    expect(q.summary).toBe("This should be quarantined");
    expect(q.reason).toContain("Session mismatch");
    expect(typeof q.quarantinedAt).toBe("number");
    expect(typeof q.createdAt).toBe("number");

    cleanupDurableSession(sid);
  });
});

describe("validateBlocksProvenance edge cases", () => {
  it("does not quarantine blocks without provenance (legacy preserved)", () => {
    const sid = freshSessionId();

    addBlock(sid, "legacy-1", "Legacy block", "l", "l");
    addBlock(sid, "legacy-2", "Another legacy", "l", "l");

    const session = mockSession({
      sessionId: sid,
      branchIds: ["entry-1", "entry-2"],
    });

    const count = validateBlocksProvenance(sid, session);
    expect(count).toBe(0);

    const blocks = getBlocks(sid);
    expect(blocks.length).toBe(2);
    // Both should still be legacy (no provenance attached)
    expect(blocks.every((b) => !b.provenance)).toBe(true);

    cleanupDurableSession(sid);
  });

  it("handles empty blocks gracefully", () => {
    const sid = freshSessionId();
    const session = mockSession({
      sessionId: sid,
      branchIds: [],
    });

    const count = validateBlocksProvenance(sid, session);
    expect(count).toBe(0);
  });

  it("can quarantine multiple blocks at once", () => {
    const sid = freshSessionId();
    const wrongSession = "wrong-session";

    // Add 2 blocks with wrong session
    addBlock(
      sid,
      "bad-1",
      "Bad block 1",
      "l",
      "l",
      undefined,
      fakeProvenance({
        sessionId: wrongSession,
        leafId: null,
        coveredEntryIds: [],
      }),
    );
    addBlock(
      sid,
      "bad-2",
      "Bad block 2",
      "l",
      "l",
      undefined,
      fakeProvenance({
        sessionId: wrongSession,
        leafId: null,
        coveredEntryIds: [],
      }),
    );

    // Add 1 valid block
    addBlock(
      sid,
      "good",
      "Good block",
      "l",
      "l",
      undefined,
      fakeProvenance({
        sessionId: sid,
        leafId: null,
        coveredEntryIds: [],
      }),
    );

    const session = mockSession({
      sessionId: sid,
      branchIds: [],
    });

    const count = validateBlocksProvenance(sid, session);
    expect(count).toBe(2);

    const blocks = getBlocks(sid);
    expect(blocks.length).toBe(1);
    expect(blocks[0].topic).toBe("good");

    const quarantined = getQuarantinedBlocks(sid);
    expect(quarantined.length).toBe(2);

    cleanupDurableSession(sid);
  });
});

describe("captureProvenance edge cases", () => {
  it("handles empty branch", () => {
    const session = mockSession({
      sessionId: "s1",
      branchIds: [],
    });

    const prov = captureProvenance(session, 1000, undefined, "test");

    expect(prov.coveredEntryIds).toEqual([]);
    expect(prov.leafId).toBeNull();
  });

  it("handles null leafId", () => {
    const session = mockSession({
      sessionId: "s1",
      leafId: null,
      branchIds: ["entry-1", "entry-2"],
    });

    const prov = captureProvenance(session, 1000, undefined, "test");

    expect(prov.coveredEntryIds).toEqual(["entry-1", "entry-2"]);
    expect(prov.summarySource).toBe("test");
  });
});
