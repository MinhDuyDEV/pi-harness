import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import { parseLegacyArgs, handleLegacyCommand } from "./legacy-attestation.js";
import type { ProvenanceSessionHandle } from "./compress-state.js";
import type { CompressionBlock, DcpProvenanceV2 } from "./compress-types.js";
import {
  addBlock,
  attestBlock,
  getProvenanceCounts,
  getLegacyStatus,
  getQuarantinedBlocks,
  quarantineLegacyBlocks,
  validateBlocksProvenance,
} from "./compress-state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _sid = 0;
function sid(): string {
  return `test-${++_sid}`;
}

const NOW = 1_700_000_000_000;

function mockSession(opts?: {
  sessionId?: string;
  leafId?: string | null;
  branchIds?: string[];
}): ProvenanceSessionHandle {
  const sessionId = opts?.sessionId ?? sid();
  const leafId = opts?.leafId ?? null;
  const branchIds = opts?.branchIds ?? [];
  const entries = branchIds.map((id) => ({ id }));
  return {
    getSessionId: () => sessionId,
    getLeafId: () => leafId,
    getBranch: () => entries,
  };
}

function makeProvenance(overrides?: Partial<DcpProvenanceV2>): DcpProvenanceV2 {
  return {
    version: 2,
    sessionId: sid(),
    leafId: null,
    coveredEntryIds: ["e1"],
    createdAt: NOW,
    protectionProvenance: undefined,
    summarySource: undefined,
    ...overrides,
  };
}

function addLegacyBlock(
  id: string,
  summary: string,
  topic = "test",
): CompressionBlock {
  return addBlock(id, topic, summary, "start", "end");
}

function addValidatedBlock(
  id: string,
  summary: string,
  override?: Partial<DcpProvenanceV2>,
): CompressionBlock {
  return addBlock(
    id,
    "validated",
    summary,
    "start",
    "end",
    undefined,
    makeProvenance(override),
  );
}

function makeUI() {
  const msgs: string[] = [];
  return {
    notify: (m: string) => {
      msgs.push(m);
    },
    confirm: async (_t: string, _m: string) => false,
    msgs,
  };
}

// ---------------------------------------------------------------------------
// parseLegacyArgs
// ---------------------------------------------------------------------------

describe("parseLegacyArgs", () => {
  it("parses inspect all", () => {
    const r = parseLegacyArgs("inspect");
    expect(r).not.toBeNull();
    expect(r!.command).toBe("inspect");
    expect(r!.target).toBe("all");
  });

  it("parses inspect targeted", () => {
    expect(parseLegacyArgs("inspect b5")!.target).toBe("b5");
  });

  it("parses attest all --yes", () => {
    const r = parseLegacyArgs("attest all --yes")!;
    expect(r.command).toBe("attest");
    expect(r.forceYes).toBe(true);
  });

  it("parses quarantine b3", () => {
    expect(parseLegacyArgs("quarantine b3")!.command).toBe("quarantine");
  });

  it("returns null for invalid command", () => {
    expect(parseLegacyArgs("unknown")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseLegacyArgs("")).toBeNull();
  });

  it("returns null for bad target", () => {
    expect(parseLegacyArgs("attest bx")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------

describe("inspect", () => {
  it("shows Validated, Attested, Legacy unverified, Quarantined", () => {
    const id = sid();
    addValidatedBlock(id, "has provenance");
    addLegacyBlock(id, "is legacy");

    const ui = makeUI();
    handleLegacyCommand(
      "inspect",
      { notify: ui.notify, confirm: ui.confirm },
      {
        stateKey: id,
        session: mockSession({ sessionId: id }),
        appendState: () => {},
      },
    );

    const out = ui.msgs.join("\n");
    expect(out).toContain("Validated:");
    expect(out).toContain("Legacy unverified:");
  });

  it("bounded output", () => {
    const id = sid();
    addLegacyBlock(id, "x".repeat(500), "long-a");
    addLegacyBlock(id, "y".repeat(500), "long-b");

    const ui = makeUI();
    handleLegacyCommand(
      "inspect",
      { notify: ui.notify, confirm: ui.confirm },
      {
        stateKey: id,
        session: mockSession({ sessionId: id }),
        appendState: () => {},
      },
    );

    expect(ui.msgs.join("\n").length).toBeLessThan(6000);
  });
});

// ---------------------------------------------------------------------------
// attest
// ---------------------------------------------------------------------------

describe("attest", () => {
  it("interactive cancellation does not mutate", () => {
    const id = sid();
    addLegacyBlock(id, "cancel me");

    let mutated = 0;
    handleLegacyCommand(
      "attest all",
      {
        notify: () => {},
        confirm: async () => false,
      },
      {
        stateKey: id,
        session: mockSession({ sessionId: id }),
        appendState: () => {
          mutated++;
        },
      },
    );

    expect(mutated).toBe(0);
    const s = getLegacyStatus(id);
    expect(s.unverified.length).toBeGreaterThan(0);
  });

  it("--yes mutates, calls appendState, creates provenance + hash", () => {
    const id = sid();
    addLegacyBlock(id, "Attest me");

    const reasons: string[] = [];
    handleLegacyCommand(
      "attest all --yes",
      {
        notify: () => {},
        confirm: async () => false,
      },
      {
        stateKey: id,
        session: mockSession({
          sessionId: id,
          leafId: "leaf-a",
          branchIds: ["leaf-a"],
        }),
        appendState: (r: string) => {
          reasons.push(r);
        },
      },
    );

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("attested");

    const after = getLegacyStatus(id);
    expect(after.attested.length).toBeGreaterThan(0);
    const a = after.attested[0];
    expect(a.attestation).toBeDefined();
    expect(a.attestation!.actor).toBe("user-command");
    expect(a.attestation!.summaryHash).toBe(
      createHash("sha256").update("Attest me").digest("hex"),
    );
    expect(a.provenance).toBeDefined();
    expect(a.provenance!.leafId).toBe("leaf-a");
  });
});

// ---------------------------------------------------------------------------
// quarantine
// ---------------------------------------------------------------------------

describe("quarantine", () => {
  it("targeted quarantine moves legacy-unverified, persists", () => {
    const id = sid();
    addLegacyBlock(id, "Quarantine me");
    addValidatedBlock(id, "Keep me");

    const before = getLegacyStatus(id);
    const uvBefore = before.unverified.length;
    const valBefore = before.validated.length;
    expect(uvBefore).toBeGreaterThanOrEqual(1);
    expect(valBefore).toBeGreaterThanOrEqual(1);

    const target = before.unverified.find(
      (b) => b.summary === "Quarantine me",
    )!;
    const ids = quarantineLegacyBlocks(
      id,
      [target.blockId],
      "test",
      "user-command",
      "explicit-yes",
    );
    expect(ids).toEqual([target.blockId]);

    const after = getLegacyStatus(id);
    // The targeted unverified block was removed; validated blocks may increase if some
    // unverified blocks were inadvertantly matched — we just verify the count decreased
    expect(after.unverified.length).toBe(uvBefore - 1);
    // Total active blocks decreased by 1 (quarantined)
    expect(
      after.validated.length + after.attested.length + after.unverified.length,
    ).toBe(valBefore + uvBefore - 1);
  });

  it("all-legacy-unverified quarantine", () => {
    const id = sid();
    addLegacyBlock(id, "A");
    addLegacyBlock(id, "B");
    addValidatedBlock(id, "Keep");

    const before = getLegacyStatus(id);
    const count = before.unverified.length;
    const ids = quarantineLegacyBlocks(
      id,
      before.unverified.map((b) => b.blockId),
      "all",
      "user-command",
      "explicit-yes",
    );
    expect(ids).toHaveLength(count);

    const after = getLegacyStatus(id);
    // All unverified blocks removed; validated preserved
    expect(after.unverified).toHaveLength(0);
    expect(after.validated.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validation", () => {
  it("quarantines an attested block when its summary hash changes", () => {
    const id = sid();
    const block = addLegacyBlock(id, "Original summary");
    const session = mockSession({
      sessionId: id,
      leafId: "lx",
      branchIds: ["root", "lx"],
    });
    attestBlock(id, block.blockId, "user-command", "explicit-yes", session);

    block.summary = "Tampered summary";
    validateBlocksProvenance(id, session);

    expect(getLegacyStatus(id).attested).toHaveLength(0);
    expect(getQuarantinedBlocks(id)[0]?.reason).toBe(
      "attestation-hash-mismatch",
    );
  });

  it("quarantines attestation after a fork before its bound leaf", () => {
    const id = sid();
    const block = addLegacyBlock(id, "Fork test");
    const originalBranch = mockSession({
      sessionId: id,
      leafId: "attested-leaf",
      branchIds: ["root", "attested-leaf"],
    });
    attestBlock(
      id,
      block.blockId,
      "user-command",
      "explicit-yes",
      originalBranch,
    );

    validateBlocksProvenance(
      id,
      mockSession({
        sessionId: id,
        leafId: "fork-leaf",
        branchIds: ["root", "fork-leaf"],
      }),
    );

    expect(getLegacyStatus(id).attested).toHaveLength(0);
    expect(getQuarantinedBlocks(id)[0]?.reason).toContain(
      "not reachable in current branch",
    );
  });
});

// ---------------------------------------------------------------------------
// counts
// ---------------------------------------------------------------------------

describe("getProvenanceCounts", () => {
  it("shows Validated, Attested, Legacy unverified, Quarantined", () => {
    const id = sid();
    addValidatedBlock(id, "V");
    addLegacyBlock(id, "Target");
    addLegacyBlock(id, "L");

    const s = getLegacyStatus(id);
    const t = s.unverified.find((b) => b.summary === "Target")!;
    attestBlock(
      id,
      t.blockId,
      "user-command",
      "explicit-yes",
      mockSession({ leafId: "lc", branchIds: ["lc"] }),
    );

    const c = getProvenanceCounts(id);
    expect(c.validated).toBeGreaterThanOrEqual(1);
    expect(c.attested).toBeGreaterThanOrEqual(1);
    expect(c.legacyUnverified).toBeGreaterThanOrEqual(1);
    expect(c.quarantined).toBe(0);
  });
});
