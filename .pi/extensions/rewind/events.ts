import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  CHECKPOINT_SOURCE_ALLOWLIST,
  addBindingToCollector,
  FORK_PREFERENCE_SOURCE_ALLOWLIST,
  RETENTION_VERSION,
  findAssistantEntryForTurn,
  getTextContent,
  isRestorableTreeEntry,
  type PendingResultingState,
  type RewindOpData,
  type RewindRuntimeState,
  type SessionLikeEntry,
} from "./core.js";
import type { LedgerManager } from "./ledger.js";
import type { RetentionManager } from "./retention.js";
import type { SnapshotStore } from "./store.js";

export interface RewindEventDeps {
  state: RewindRuntimeState;
  store: SnapshotStore;
  ledger: LedgerManager;
  retention: RetentionManager;
  checkpointEntry: (ctx: ExtensionContext, entryId: string) => Promise<void>;
  initializeForSession: (ctx: ExtensionContext) => Promise<void>;
  syncSessionIdentity: (ctx: ExtensionContext) => void;
  getActiveContext: () => ExtensionContext | undefined;
  notify: (ctx: ExtensionContext, message: string, level?: "info" | "warning" | "error") => void;
  updateStatus: (ctx: ExtensionContext) => void;
  /** True while a boomerang collapse is in progress (tree navigation auto-snapshots without UI). Test-injected via the deps wiring in index.ts. */
  boomerangCollapseInProgress?: () => boolean;
}

export function registerRewindEvents(pi: ExtensionAPI, deps: RewindEventDeps): void {
  const { state } = deps;
  pi.events.on("rewind:fork-preference", (data) => {
    if (!isRecord(data) || data.mode !== "conversation-only" || typeof data.source !== "string") return;
    if (!FORK_PREFERENCE_SOURCE_ALLOWLIST.has(data.source)) return;
    state.forceConversationOnlyOnNextFork = true;
    state.forceConversationOnlySource = data.source;
  });
  pi.events.on("rewind:checkpoint-entry", (data) => registerCheckpoint(data, deps));

  pi.on("before_agent_start", async (event) => {
    state.activePromptText = getTextContent(event.prompt);
  });
  pi.on("session_start", async (event, ctx) => handleSessionStart(event, ctx, deps));
  pi.on("session_tree", async (event, ctx) => handleSessionTree(event, ctx, deps));
  pi.on("session_compact", async (event, ctx) => handleSessionCompact(event, ctx, deps));
  pi.on("session_shutdown", async (_event, ctx) => {
    deps.syncSessionIdentity(ctx);
    if (state.isGitRepo) await deps.retention.maybeSweep(ctx, "shutdown");
  });
  pi.on("turn_start", async (event, ctx) => handleTurnStart(event, ctx, deps));
  pi.on("turn_end", async (event, ctx) => handleTurnEnd(event, ctx, deps));
  pi.on("agent_end", async (_event, ctx) => handleAgentEnd(ctx, deps));
  pi.on("session_before_fork", async (event, ctx) => handleBeforeFork(event, ctx, deps));
  pi.on("session_before_tree", async (event, ctx) => handleBeforeTree(event, ctx, deps));
}

function registerCheckpoint(data: unknown, deps: RewindEventDeps): Promise<void> | undefined {
  if (!isRecord(data) || typeof data.source !== "string" || !CHECKPOINT_SOURCE_ALLOWLIST.has(data.source) || typeof data.entryId !== "string") return undefined;
  const ctx = deps.getActiveContext();
  if (!ctx) return undefined;
  return deps.checkpointEntry(ctx, data.entryId).catch((error) => {
    deps.notify(ctx, `Rewind: failed to checkpoint ${data.entryId} (${errorMessage(error)})`, "warning");
  });
}

async function handleSessionStart(event: { reason?: string; previousSessionFile?: string }, ctx: ExtensionContext, deps: RewindEventDeps): Promise<void> {
  await deps.initializeForSession(ctx);
  if (event.reason !== "fork" || !event.previousSessionFile || !deps.state.isGitRepo) return;
  const previousLedger = await deps.ledger.parseSessionLedgerFile(event.previousSessionFile);
  const pending = previousLedger?.latestForkPending;
  if (!pending || !(await deps.store.commitExists(pending.current))) return;
  const snapshots = [pending.current];
  const data: RewindOpData = { v: RETENTION_VERSION, snapshots, current: 0 };
  if (pending.undo && await deps.store.commitExists(pending.undo)) {
    snapshots.push(pending.undo);
    data.undo = 1;
  }
  deps.ledger.appendRewindOp(ctx, data);
  await deps.ledger.reconstructState(ctx);
  deps.updateStatus(ctx);
}

async function handleSessionTree(event: { summaryEntry?: { id?: string } }, ctx: ExtensionContext, deps: RewindEventDeps): Promise<void> {
  deps.syncSessionIdentity(ctx);
  await deps.ledger.reconstructState(ctx);
  const pending = deps.state.pendingTreeState;
  if (!deps.state.isGitRepo || !pending) {
    deps.updateStatus(ctx);
    return;
  }
  const data: RewindOpData = { v: RETENTION_VERSION, snapshots: [pending.currentCommitSha], current: 0 };
  if (pending.undoCommitSha) {
    data.snapshots.push(pending.undoCommitSha);
    data.undo = 1;
  }
  if (event.summaryEntry?.id) data.bindings = [[event.summaryEntry.id, 0]];
  deps.ledger.appendRewindOp(ctx, data);
  deps.state.pendingTreeState = null;
  await deps.ledger.reconstructState(ctx);
  deps.updateStatus(ctx);
}

async function handleSessionCompact(event: { compactionEntry: { id: string } }, ctx: ExtensionContext, deps: RewindEventDeps): Promise<void> {
  deps.syncSessionIdentity(ctx);
  if (!deps.state.isGitRepo) return;
  const current = deps.state.activeBranchState.currentCommitSha ?? await deps.store.ensureSnapshotForCurrentWorktree();
  deps.ledger.appendRewindOp(ctx, { v: RETENTION_VERSION, snapshots: [current], bindings: [[event.compactionEntry.id, 0]] });
  await deps.ledger.reconstructState(ctx);
  deps.updateStatus(ctx);
}

async function handleTurnStart(event: { turnIndex: number }, ctx: ExtensionContext, deps: RewindEventDeps): Promise<void> {
  if (!deps.state.isGitRepo || event.turnIndex !== 0) return;
  try {
    const commitSha = await deps.store.ensureSnapshotForCurrentWorktree();
    deps.state.promptCollector = { snapshots: [], bindings: [], promptText: deps.state.activePromptText ?? undefined, pendingUserCommitSha: commitSha };
    deps.ledger.bindPendingPromptUser(ctx.sessionManager.getBranch() as SessionLikeEntry[], deps.state.promptCollector);
  } catch (error) {
    deps.state.promptCollector = null;
    deps.notify(ctx, `Rewind: failed to capture start snapshot (${errorMessage(error)})`, "warning");
  }
}

async function handleTurnEnd(event: { message: { role?: string; content?: unknown; timestamp?: number } }, ctx: ExtensionContext, deps: RewindEventDeps): Promise<void> {
  const collector = deps.state.promptCollector;
  if (!deps.state.isGitRepo || !collector) return;
  try {
    const entries = ctx.sessionManager.getBranch() as SessionLikeEntry[];
    deps.ledger.bindPendingPromptUser(entries, collector);
    if (event.message.role !== "assistant") return;
    const assistantEntry = findAssistantEntryForTurn(entries, event.message);
    if (!assistantEntry) return;
    const commitSha = await deps.store.ensureSnapshotForCurrentWorktree();
    addBindingToCollector(collector, assistantEntry.id, commitSha);
  } catch (error) {
    deps.notify(ctx, `Rewind: failed to capture assistant snapshot (${errorMessage(error)})`, "warning");
  }
}

async function handleAgentEnd(ctx: ExtensionContext, deps: RewindEventDeps): Promise<void> {
  const collector = deps.state.promptCollector;
  if (!deps.state.isGitRepo || !collector) return;
  try {
    deps.ledger.bindPendingPromptUser(ctx.sessionManager.getBranch() as SessionLikeEntry[], collector);
    deps.ledger.appendRewindTurn(ctx, collector);
    await deps.ledger.reconstructState(ctx);
    deps.updateStatus(ctx);
    await deps.retention.maybeSweep(ctx, "new-snapshots");
  } catch (error) {
    deps.notify(ctx, `Rewind: failed to finalize rewind turn (${errorMessage(error)})`, "warning");
  } finally {
    deps.state.promptCollector = null;
    deps.state.activePromptText = null;
  }
}

async function handleBeforeFork(event: { entryId: string }, ctx: ExtensionContext, deps: RewindEventDeps): Promise<{ cancel?: boolean; skipConversationRestore?: boolean } | undefined> {
  const forced = deps.state.forceConversationOnlyOnNextFork;
  const source = deps.state.forceConversationOnlySource;
  deps.state.forceConversationOnlyOnNextFork = false;
  deps.state.forceConversationOnlySource = null;
  if (!deps.state.isGitRepo) return undefined;
  try {
    if (!ctx.hasUI) return appendConversationOnlyFork(ctx, deps);
    const target = await deps.ledger.resolveEntrySnapshotWithLineage(event.entryId);
    const hasUndo = await exists(deps, deps.state.activeBranchState.undoCommitSha);
    if (forced) return appendConversationOnlyFork(ctx, deps, source ?? undefined);
    const choice = await selectForkChoice(ctx, Boolean(target), hasUndo);
    if (!choice) {
      deps.notify(ctx, "Rewind cancelled");
      return { cancel: true };
    }
    return await applyForkChoice(choice, target, ctx, deps);
  } catch (error) {
    deps.notify(ctx, `Rewind failed before fork: ${errorMessage(error)}`, "error");
    return { cancel: true };
  }
}

async function selectForkChoice(ctx: ExtensionContext, hasTarget: boolean, hasUndo: boolean): Promise<string | undefined> {
  const options = ["Conversation only (keep current files)"];
  if (hasTarget) options.push("Restore all (files + conversation)", "Code only (restore files, keep conversation)");
  if (hasUndo) options.push("Undo last file rewind");
  return ctx.ui.select("Restore Options", options);
}

async function applyForkChoice(choice: string, target: string | undefined, ctx: ExtensionContext, deps: RewindEventDeps): Promise<{ skipConversationRestore?: boolean; cancel?: boolean } | undefined> {
  if (choice === "Undo last file rewind" && deps.state.activeBranchState.undoCommitSha) {
    const restore = await deps.store.restoreCommitExactly(deps.state.activeBranchState.undoCommitSha);
    appendPending(ctx, { currentCommitSha: deps.state.activeBranchState.undoCommitSha, undoCommitSha: restore.undoCommitSha }, deps);
    deps.notify(ctx, "Files restored to before last rewind");
    return undefined;
  }
  if (choice === "Conversation only (keep current files)") return appendConversationOnlyFork(ctx, deps);
  if (!target) {
    deps.notify(ctx, "No exact rewind point available for that entry", "error");
    return { cancel: true };
  }
  const restore = await deps.store.restoreCommitExactly(target);
  appendPending(ctx, { currentCommitSha: target, undoCommitSha: restore.undoCommitSha }, deps);
  deps.notify(ctx, "Files restored from rewind point");
  return choice === "Code only (restore files, keep conversation)" ? { skipConversationRestore: true } : undefined;
}

async function appendConversationOnlyFork(ctx: ExtensionContext, deps: RewindEventDeps, source?: string): Promise<undefined> {
  appendPending(ctx, { currentCommitSha: await deps.store.ensureSnapshotForCurrentWorktree() }, deps);
  if (source) deps.notify(ctx, `Rewind: using conversation-only fork (keep current files) (${source})`);
  return undefined;
}

async function handleBeforeTree(event: { preparation: { targetId: string } }, ctx: ExtensionContext, deps: RewindEventDeps): Promise<{ cancel?: boolean } | undefined> {
  if (!deps.state.isGitRepo) return undefined;
  try {
    if (isBoomerangCollapse(deps)) {
      deps.state.pendingTreeState = { currentCommitSha: await deps.store.ensureSnapshotForCurrentWorktree() };
      return undefined;
    }
    if (!ctx.hasUI) return undefined;
    const targetEntry = ctx.sessionManager.getEntry(event.preparation.targetId) as SessionLikeEntry | undefined;
    const target = isRestorableTreeEntry(targetEntry) ? await deps.ledger.resolveEntrySnapshotWithLineage(event.preparation.targetId) : undefined;
    const hasUndo = await exists(deps, deps.state.activeBranchState.undoCommitSha);
    const choice = await selectTreeChoice(ctx, Boolean(target), hasUndo);
    if (!choice || choice === "Cancel navigation") {
      deps.notify(ctx, "Navigation cancelled");
      return { cancel: true };
    }
    return await applyTreeChoice(choice, target, ctx, deps);
  } catch (error) {
    deps.state.pendingTreeState = null;
    deps.notify(ctx, `Rewind failed before tree navigation: ${errorMessage(error)}`, "error");
    return { cancel: true };
  }
}

async function selectTreeChoice(ctx: ExtensionContext, hasTarget: boolean, hasUndo: boolean): Promise<string | undefined> {
  const options = ["Keep current files"];
  if (hasTarget) options.push("Restore files to that point");
  if (hasUndo) options.push("Undo last file rewind");
  options.push("Cancel navigation");
  return ctx.ui.select("Restore Options", options);
}

async function applyTreeChoice(choice: string, target: string | undefined, ctx: ExtensionContext, deps: RewindEventDeps): Promise<{ cancel?: boolean } | undefined> {
  if (choice === "Undo last file rewind" && deps.state.activeBranchState.undoCommitSha) {
    const restore = await deps.store.restoreCommitExactly(deps.state.activeBranchState.undoCommitSha);
    const snapshots = [deps.state.activeBranchState.undoCommitSha];
    const data: RewindOpData = { v: RETENTION_VERSION, snapshots, current: 0 };
    if (restore.undoCommitSha) {
      snapshots.push(restore.undoCommitSha);
      data.undo = 1;
    }
    deps.ledger.appendRewindOp(ctx, data);
    deps.notify(ctx, "Files restored to before last rewind");
    await deps.ledger.reconstructState(ctx);
    return { cancel: true };
  }
  if (choice === "Keep current files") {
    deps.state.pendingTreeState = { currentCommitSha: await deps.store.ensureSnapshotForCurrentWorktree() };
    return undefined;
  }
  if (!target) {
    deps.notify(ctx, "Exact file rewind is only available for user, assistant, custom message, compaction, and summary nodes", "error");
    return { cancel: true };
  }
  const restore = await deps.store.restoreCommitExactly(target);
  deps.state.pendingTreeState = { currentCommitSha: target, undoCommitSha: restore.undoCommitSha };
  deps.notify(ctx, "Files restored to rewind point");
  return undefined;
}

function appendPending(ctx: ExtensionContext, pending: PendingResultingState, deps: RewindEventDeps): void {
  deps.ledger.appendForkPendingState(pending);
  deps.state.pendingTreeState = pending;
}

async function exists(deps: RewindEventDeps, commitSha: string | undefined): Promise<boolean> {
  return !!commitSha && await deps.store.commitExists(commitSha);
}

function isBoomerangCollapse(deps: RewindEventDeps): boolean {
  return deps.boomerangCollapseInProgress?.() ?? false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
