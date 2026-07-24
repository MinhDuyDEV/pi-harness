import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  RETENTION_SWEEP_THRESHOLD,
  getRetentionScanMode,
  getRetentionSettings,
  getStartupSweepBudgetMs,
  isInsidePath,
  type ParsedSessionLedger,
  type RewindRetentionSettings,
  type RewindRuntimeState,
} from "./core.js";
import type { LedgerManager } from "./ledger.js";
import type { SnapshotStore } from "./store.js";

export type SweepReason = "startup" | "new-snapshots" | "shutdown";

export interface RetentionManager {
  maybeSweep(ctx: ExtensionContext, reason: SweepReason): Promise<void>;
}

export function createRetentionManager(
  pi: ExtensionAPI,
  state: RewindRuntimeState,
  store: SnapshotStore,
  ledger: LedgerManager,
  notify: (ctx: ExtensionContext, message: string, level?: "info" | "warning") => void,
  updateStatus: (ctx: ExtensionContext) => void,
): RetentionManager {
  const maybeSweep = async (ctx: ExtensionContext, reason: SweepReason): Promise<void> => {
    const retention = getRetentionSettings();
    if (!shouldSweep(state, retention, reason)) return;
    state.sweepRunning = true;
    try {
      await runSweep(ctx, reason, retention!);
    } finally {
      state.sweepRunning = false;
    }
  };

  const runSweep = async (ctx: ExtensionContext, reason: SweepReason, retention: RewindRetentionSettings): Promise<void> => {
    const startedAt = Date.now();
    const budget = getStartupSweepBudgetMs();
    const exceeded = () => reason === "startup" && typeof budget === "number" && Date.now() - startedAt > budget;
    const stopIfExceeded = (): boolean => {
      if (!exceeded()) return false;
      notify(ctx, `Rewind retention startup sweep skipped after exceeding ${budget}ms budget`, "warning");
      return true;
    };

    const sessionFiles = await ledger.discoverSessionFiles(getRetentionScanMode());
    if (stopIfExceeded()) return;
    const ledgers = await loadLedgers(ctx, sessionFiles, state, ledger, stopIfExceeded);
    if (!ledgers) return;
    const protectedCommits = collectProtectedCommits(ledgers, retention);
    for (const commitSha of [...protectedCommits.current, ...protectedCommits.undo]) {
      if (stopIfExceeded()) return;
      if (await store.commitExists(commitSha)) protectedCommits.pinned.add(commitSha);
    }

    const candidates = selectCandidates(protectedCommits.latest, protectedCommits.pinned, retention);
    const existingLiveSet: string[] = [];
    for (const commitSha of [...protectedCommits.pinned, ...candidates]) {
      if (stopIfExceeded()) return;
      if (await store.commitExists(commitSha)) existingLiveSet.push(commitSha);
    }
    if (await store.rewriteStoreToLiveSet(existingLiveSet) === "preserved-empty") return;
    if (reason !== "startup") await runAutoGc(pi);
    state.newSnapshotsSinceSweep = 0;
    state.sweepCompletedThisSession = true;
    updateStatus(ctx);
  };

  return { maybeSweep };
}

function shouldSweep(state: RewindRuntimeState, retention: RewindRetentionSettings | undefined, reason: SweepReason): boolean {
  if (!retention || !state.repoRoot || state.sweepRunning) return false;
  if (reason === "new-snapshots" && state.newSnapshotsSinceSweep < RETENTION_SWEEP_THRESHOLD) return false;
  return !(reason === "shutdown" && state.sweepCompletedThisSession && state.newSnapshotsSinceSweep < RETENTION_SWEEP_THRESHOLD);
}

async function loadLedgers(
  ctx: ExtensionContext,
  sessionFiles: string[],
  state: RewindRuntimeState,
  ledger: LedgerManager,
  stopIfExceeded: () => boolean,
): Promise<ParsedSessionLedger[] | null> {
  const result: ParsedSessionLedger[] = [];
  for (const sessionFile of sessionFiles) {
    if (stopIfExceeded()) return null;
    const current = sessionFile === state.currentSessionFile ? ledger.buildCurrentSessionLedger(ctx) : await ledger.parseSessionLedgerFile(sessionFile);
    if (current?.cwd && state.repoRoot && isInsidePath(current.cwd, state.repoRoot)) result.push(current);
  }
  return result;
}

function collectProtectedCommits(ledgers: ParsedSessionLedger[], retention: RewindRetentionSettings): {
  latest: Map<string, number>;
  pinned: Set<string>;
  current: Set<string>;
  undo: Set<string>;
} {
  const latest = new Map<string, number>();
  const pinned = new Set<string>();
  const current = new Set<string>();
  const undo = new Set<string>();
  for (const ledger of ledgers) {
    for (const reference of ledger.references) {
      latest.set(reference.commitSha, Math.max(latest.get(reference.commitSha) ?? 0, reference.timestamp));
      if (reference.kind === "binding" && retention.pinLabeledEntries && reference.entryId && ledger.labeledEntryIds.has(reference.entryId)) pinned.add(reference.commitSha);
    }
    if (ledger.latestCurrentCommitSha) current.add(ledger.latestCurrentCommitSha);
    if (ledger.latestUndoCommitSha) undo.add(ledger.latestUndoCommitSha);
  }
  return { latest, pinned, current, undo };
}

function selectCandidates(latest: Map<string, number>, pinned: Set<string>, retention: RewindRetentionSettings): string[] {
  let candidates = [...latest.entries()]
    .filter(([commitSha]) => !pinned.has(commitSha))
    .sort((left, right) => right[1] - left[1]);
  if (typeof retention.maxAgeDays === "number" && retention.maxAgeDays >= 0) {
    const cutoff = Date.now() - retention.maxAgeDays * 86_400_000;
    candidates = candidates.filter(([, timestamp]) => timestamp >= cutoff);
  }
  if (typeof retention.maxSnapshots === "number" && retention.maxSnapshots >= 0) candidates = candidates.slice(0, retention.maxSnapshots);
  return candidates.map(([commitSha]) => commitSha);
}

async function runAutoGc(pi: ExtensionAPI): Promise<void> {
  try {
    const result = await pi.exec("git", ["gc", "--auto"]);
    if (result.code !== 0) throw new Error(result.stderr.trim() || `git gc --auto failed with code ${result.code}`);
  } catch {
    return;
  }
}
