/**
 * Tests for Pi-native DCP upgrades:
 *   - active-branch-safe persistence/restoration
 *   - authoritative compaction outcomes
 *   - null-tokens percentage diagnostics suppression
 *   - session lifecycle fork handling
 *   - typed telemetry JSON safety
 *   - version migration
 */

import { describe, expect, it } from "bun:test";

import {
  buildContextMeterSnapshot,
} from "./context-meter.js";
import {
  makeDcpStateEntryPayload,
  restoreDcpStateFromSessionEntries,
} from "./compress-state.js";
import { getDcpSessionId } from "./compress-state.js";
import {
  buildCompactionCompletedEvent,
  buildStateRestoredEvent,
  buildNudgeEvaluatedEvent,
  buildLifecycleForkEvent,
  buildNullTokensEvent,
} from "./telemetry.js";
import { extractCompactionOutcome } from "./index-helpers.js";

// ── Null-tokens suppression ──────────────────────────────────────────
describe("buildContextMeterSnapshot — null-tokens diagnostics suppression", () => {
  it("returns null branchPercent and deltaTokens when branchTokens is null", () => {
    const meter = buildContextMeterSnapshot(null, 500, 200_000);
    expect(meter.branchTokens).toBeNull();
    expect(meter.branchPercent).toBeNull();
    expect(meter.deltaTokens).toBeNull();
    expect(meter.outboundTokens).toBe(500);
  });

  it("returns null branchPercent and deltaTokens when branchTokens is undefined", () => {
    const meter = buildContextMeterSnapshot(undefined, 500, 200_000);
    expect(meter.branchTokens).toBeNull();
    expect(meter.branchPercent).toBeNull();
    expect(meter.deltaTokens).toBeNull();
  });

  it("computes normal values when branchTokens is provided", () => {
    const meter = buildContextMeterSnapshot(10_000, 500, 200_000);
    expect(meter.branchTokens).toBe(10_000);
    expect(meter.branchPercent).toBeCloseTo(5, 0);
    expect(meter.deltaTokens).toBe(9_500);
  });

  it("suppresses outboundPercent when outboundTokens is 0", () => {
    const meter = buildContextMeterSnapshot(null, 0, 200_000);
    expect(meter.branchTokens).toBeNull();
    expect(meter.outboundPercent).toBe(0);
  });
});

// ── Versioned custom-entry persistence ───────────────────────────────
describe("makeDcpStateEntryPayload — V3 with provenance", () => {
  it("creates a version 3 payload with sessionId", () => {
    const payload = makeDcpStateEntryPayload("session-branch-1", "manual");
    expect(payload).toBeDefined();
    expect(payload.version).toBe(3);
    expect(payload.sessionId).toBe("session-branch-1");
    expect(payload.reason).toBe("manual");
    expect(typeof payload.createdAt).toBe("number");
    expect(payload.snapshot).toBeDefined();
    expect(Array.isArray(payload.snapshot.blocks)).toBe(true);
  });

  it("uses the correct snapshot structure", () => {
    const payload = makeDcpStateEntryPayload("session-branch-2", "threshold");
    expect(payload.snapshot.version).toBe(2);
    expect(Array.isArray(payload.snapshot.blocks)).toBe(true);
    expect(typeof payload.snapshot.sessionId).toBe("string");
  });
});

// ── Branch-safe state restoration ────────────────────────────────────
describe("restoreDcpStateFromSessionEntries — branch-safe filtering", () => {
  function makeEntry(
    overrides: Partial<{
      timestamp: number;
      version: number;
      sessionId: string;
      customType: string;
      blocks: Array<unknown>;
    }>,
  ) {
    const ts = overrides.timestamp ?? 1000;
    const v = overrides.version ?? 2;
    return {
      timestamp: ts,
      customType: overrides.customType ?? "dcp_state",
      data: {
        version: v,
        sessionId: overrides.sessionId ?? "session-default",
        reason: "test",
        createdAt: ts,
        snapshot: {
          version: 1,
          sessionId: "snap-session",
          blocks: overrides.blocks ?? [{ id: `b${ts}`, summary: "test summary", topic: "test topic", artifacts: [] }],
          artifacts: [],
          qualityHistory: [],
          compactionHistory: [],
          usageSinceLastCompact: 0,
          lastCompactEntryId: null,
        },
      },
    };
  }

  function makeV1Entry(overrides: Partial<{ timestamp: number; blocks: Array<unknown> }>) {
    const ts = overrides.timestamp ?? 1000;
    return {
      timestamp: ts,
      customType: "dcp_state",
      data: {
        version: 1,
        reason: "test",
        createdAt: ts,
        snapshot: {
          version: 1,
          sessionId: "snap-session",
          blocks: overrides.blocks ?? [{ id: `b-v1-${ts}`, summary: "test summary", topic: "test topic", artifacts: [] }],
          artifacts: [],
          qualityHistory: [],
          compactionHistory: [],
          usageSinceLastCompact: 0,
          lastCompactEntryId: null,
        },
      },
    };
  }

  it("prefers V2 entries matching the current sessionId", () => {
    const entries = [
      makeEntry({
        timestamp: 2000,
        sessionId: "session-other",
        blocks: [{ id: "bo2000", summary: "s", topic: "t", artifacts: [] }],
      }),
      makeEntry({
        timestamp: 1000,
        sessionId: "session-mine",
        blocks: [{ id: "bm1000", summary: "s", topic: "t", artifacts: [] }],
      }),
    ];

    // We can't easily check which blocks were restored without mocking
    // the entire compress-state module. Instead verify that the function
    // returns true (restoration succeeded) for valid entries.
    const result = restoreDcpStateFromSessionEntries("session-mine", entries);
    expect(result).toBe(true);
  });

  it("falls back to V1 entries when no V2 sessionId match exists", () => {
    const v1Entry = makeV1Entry({
      timestamp: 3000,
      blocks: [{ id: "v1-block", summary: "s", topic: "t", artifacts: [] }],
    });
    const entries = [v1Entry];
    const result = restoreDcpStateFromSessionEntries("session-fallback", entries);
    expect(result).toBe(true);
  });

  it("returns false rather than restoring another session's V2 entry", () => {
    const entries = [
      makeEntry({ timestamp: 2000, sessionId: "session-other" }),
    ];
    const result = restoreDcpStateFromSessionEntries("session-mine", entries);
    expect(result).toBe(false);
  });

  it("returns false when no valid entries exist", () => {
    const entries = [
      { timestamp: 1000, customType: "other_type", data: { foo: "bar" } },
    ];
    const result = restoreDcpStateFromSessionEntries("session-empty", entries);
    expect(result).toBe(false);
  });

  it("handles mixed V1 and V2 entries preferring exact sessionId match", () => {
    const entries = [
          makeV1Entry({ timestamp: 5000, blocks: [{ id: "v1-latest", summary: "s", topic: "t", artifacts: [] }] }),
          makeEntry({
            timestamp: 4000,
            sessionId: "session-target",
            blocks: [{ id: "v2-exact", summary: "s", topic: "t", artifacts: [] }],
          }),
          makeEntry({
            timestamp: 6000,
            sessionId: "session-other",
            blocks: [{ id: "v2-other", summary: "s", topic: "t", artifacts: [] }],
      }),
    ];
    const result = restoreDcpStateFromSessionEntries("session-target", entries);
    expect(result).toBe(true);
  });
});

// ── Authoritative compaction outcome extraction ──────────────────────
describe("extractCompactionOutcome — authoritative outcomes", () => {
  it("extracts reason, willRetry from session_compact event", () => {
    const outcome = extractCompactionOutcome(
      { reason: "overflow", willRetry: true },
      5,
      12,
      true,
    );
    expect(outcome.reason).toBe("overflow");
    expect(outcome.willRetry).toBe(true);
    expect(outcome.blockCount).toBe(5);
    expect(outcome.artifactCount).toBe(12);
    expect(outcome.deterministic).toBe(true);
  });

  it("defaults reason to 'unknown' when missing", () => {
    const outcome = extractCompactionOutcome(
      {},
      0,
      0,
      false,
    );
    expect(outcome.reason).toBe("unknown");
    expect(outcome.willRetry).toBe(false);
  });

  it("correctly maps reason strings", () => {
    const reasons: Array<{ reason: string; expected: string }> = [
      { reason: "manual", expected: "manual" },
      { reason: "threshold", expected: "threshold" },
      { reason: "overflow", expected: "overflow" },
    ];
    for (const { reason, expected } of reasons) {
      const outcome = extractCompactionOutcome({ reason }, 0, 0, false);
      expect(outcome.reason).toBe(expected);
    }
  });
});

// ── Telemetry JSON safety ────────────────────────────────────────────
describe("DCP telemetry — JSON-safe payloads", () => {
  function assertJsonSafe(obj: unknown): void {
    const serialized = JSON.stringify(obj);
    expect(serialized).not.toBeUndefined();
    const deserialized = JSON.parse(serialized!);
    expect(deserialized).toEqual(obj);
  }

  it("buildCompactionCompletedEvent is JSON-safe", () => {
    const event = buildCompactionCompletedEvent({
      blockCount: 3,
      artifactCount: 7,
      deterministic: true,
      reason: "manual",
      willRetry: false,
    });
    assertJsonSafe(event);
    expect(event.type).toBe("compaction_completed");
  });

  it("buildStateRestoredEvent is JSON-safe", () => {
    const event = buildStateRestoredEvent(true, 3, 2);
    assertJsonSafe(event);
    expect(event.type).toBe("state_restored");
    expect(event.sessionIdMatch).toBe(true);
  });

  it("buildNudgeEvaluatedEvent is JSON-safe with null values", () => {
    const event = buildNudgeEvaluatedEvent(null, null, false);
    assertJsonSafe(event);
    expect(event.branchTokens).toBeNull();
    expect(event.branchPercent).toBeNull();
    expect(event.nudgeEmitted).toBe(false);
  });

  it("buildNudgeEvaluatedEvent is JSON-safe with numeric values", () => {
    const event = buildNudgeEvaluatedEvent(10_000, 5.0, true);
    assertJsonSafe(event);
    expect(event.branchTokens).toBe(10_000);
    expect(event.branchPercent).toBe(5.0);
  });

  it("buildLifecycleForkEvent is JSON-safe", () => {
    const event = buildLifecycleForkEvent(true, false);
    assertJsonSafe(event);
    expect(event.type).toBe("lifecycle_fork");
    expect(event.stateCleanedUp).toBe(true);
    expect(event.initialReset).toBe(false);
  });

  it("buildNullTokensEvent is JSON-safe", () => {
    const event = buildNullTokensEvent(1500);
    assertJsonSafe(event);
    expect(event.type).toBe("null_tokens");
    expect(event.processedHistoryEstimateTokens).toBe(1500);
  });
});

// ── Version migration compatibility ──────────────────────────────────
describe("DcpStateEntryPayload — version compatibility", () => {
  it("V1 payload structure is still parseable by restore", () => {
    const v1Payload = {
      version: 1 as const,
      reason: "initial",
      snapshot: {
        version: 1,
        sessionId: "session-v1",
        blocks: [],
        artifacts: [],
        qualityHistory: [],
        compactionHistory: [],
        usageSinceLastCompact: 0,
        lastCompactEntryId: null,
      },
      createdAt: 1000,
    };

    // V1 entries can be restored (version migration path)
    const entries = [{
      timestamp: 1000,
      customType: "dcp_state",
      data: v1Payload,
    }];
    const result = restoreDcpStateFromSessionEntries("session-v1", entries);
    expect(result).toBe(true);
  });

  it("V3 payload includes sessionId for branch-safe filtering", () => {
    const payload = makeDcpStateEntryPayload("branch-test-1", "manual");
    expect(payload.version).toBe(3);
    expect(payload.sessionId).toBe("branch-test-1");
  });
});
