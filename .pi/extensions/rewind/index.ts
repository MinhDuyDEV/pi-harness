import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  STATUS_KEY,
  createRewindRuntimeState,
  getSilentCheckpointsSetting,
  resetSettingsCache,
  isRestorableTreeEntry,
  type RewindOpData,
  type SessionLikeEntry,
} from "./core.js";
import { registerRewindEvents } from "./events.js";
import { createLedgerManager } from "./ledger.js";
import { createRetentionManager } from "./retention.js";
import { createSnapshotStore } from "./store.js";
import { readExtensionGate } from "../lib/harness-settings.js";

export default function rewindExtension(pi: ExtensionAPI): void {
  if (!readExtensionGate(undefined, "rewind", false)) return;
  const state = createRewindRuntimeState();
  let activeContext: ExtensionContext | undefined;
  const store = createSnapshotStore(pi, state);
  const ledger = createLedgerManager(pi, state, store, updateStatus);
  const retention = createRetentionManager(pi, state, store, ledger, notify, updateStatus);

  const syncSessionIdentity = (ctx: ExtensionContext): void => {
    state.sessionId = ctx.sessionManager.getSessionId();
    state.currentSessionFile = ctx.sessionManager.getSessionFile();
    state.currentParentSession = ctx.sessionManager.getHeader()?.parentSession;
    state.currentSessionCwd = ctx.sessionManager.getCwd();
  };

  const resetState = (): void => {
    Object.assign(state, createRewindRuntimeState());
    resetSettingsCache();
  };

  const checkpointEntry = async (ctx: ExtensionContext, entryId: string): Promise<void> => {
    syncSessionIdentity(ctx);
    if (!state.isGitRepo || state.entryToCommit.has(entryId)) return;
    const entry = ctx.sessionManager.getEntry(entryId) as SessionLikeEntry | undefined;
    if (!isRestorableTreeEntry(entry)) return;
    const currentCommitSha = await store.ensureSnapshotForCurrentWorktree();
    const data: RewindOpData = { v: 2, snapshots: [currentCommitSha], bindings: [[entryId, 0]] };
    ledger.appendRewindOp(ctx, data);
    await ledger.reconstructState(ctx);
    updateStatus(ctx);
  };

  const initializeForSession = async (ctx: ExtensionContext): Promise<void> => {
    activeContext = ctx;
    resetState();
    syncSessionIdentity(ctx);
    try {
      const result = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"]);
      state.isGitRepo = result.code === 0 && result.stdout.trim() === "true";
    } catch {
      state.isGitRepo = false;
    }
    if (!state.isGitRepo) {
      updateStatus(ctx);
      return;
    }
    await store.getRepoRoot();
    await ledger.reconstructState(ctx);
    updateStatus(ctx);
    retention.maybeSweep(ctx, "startup").catch((error) => notify(ctx, `Rewind retention startup sweep failed: ${errorMessage(error)}`, "warning"));
  };

  registerRewindEvents(pi, {
    state,
    store,
    ledger,
    retention,
    checkpointEntry,
    initializeForSession,
    syncSessionIdentity,
    getActiveContext: () => activeContext,
    notify,
    updateStatus,
    // Test-injection seam: the rewind extension does not yet track boomerang-collapse
    // state internally, so tests set globalThis.__boomerangCollapseInProgress to exercise
    // the auto-snapshot path in handleBeforeTree. Production never sets it (returns false).
    boomerangCollapseInProgress: () =>
      (globalThis as typeof globalThis & { __boomerangCollapseInProgress?: boolean }).__boomerangCollapseInProgress === true,
  });

  function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
    if (!ctx.hasUI) return;
    if (level === "info" && getSilentCheckpointsSetting()) return;
    ctx.ui.notify(message, level);
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    if (!state.isGitRepo || getSilentCheckpointsSetting()) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    const uniqueSnapshots = new Set(state.entryToCommit.values()).size;
    const theme = ctx.ui.theme;
    ctx.ui.setStatus(STATUS_KEY, theme.fg("dim", "◆ ") + theme.fg("muted", `${state.entryToCommit.size} points / ${uniqueSnapshots} snapshots`));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
