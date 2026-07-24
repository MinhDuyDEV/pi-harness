import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  RETENTION_VERSION,
  addBindingToCollector,
  addReferences,
  applyBindings,
  getCommitFromData,
  getDefaultSessionsDir,
  getTextContent,
  isRewindForkPendingData,
  isRewindOpData,
  isRewindTurnData,
  isRestorableTreeEntry,
  isSessionLikeLabelEntry,
  toTimestamp,
  type ActivePromptCollector,
  type ParsedSessionLedger,
  type PendingResultingState,
  type RewindForkPendingData,
  type RewindOpData,
  type RewindRuntimeState,
  type RewindTurnData,
  type SessionLikeEntry,
  type SessionLikeLabelEntry,
  type SessionLikeMessageEntry,
} from "./core.js";
import type { SnapshotStore } from "./store.js";

export interface LedgerManager {
  appendRewindTurn(ctx: ExtensionContext, collector: ActivePromptCollector): void;
  appendRewindOp(ctx: ExtensionContext, data: RewindOpData): void;
  appendForkPendingState(data: PendingResultingState): void;
  bindPendingPromptUser(entries: SessionLikeEntry[], collector: ActivePromptCollector): void;
  buildCurrentSessionLedger(ctx: ExtensionContext): ParsedSessionLedger;
  buildCurrentSessionLedgerFromMemory(): ParsedSessionLedger;
  parseSessionLedgerFile(sessionFile: string): Promise<ParsedSessionLedger | null>;
  resolveEntrySnapshotWithLineage(entryId: string, sessionFile?: string): Promise<string | undefined>;
  reconstructState(ctx: ExtensionContext): Promise<void>;
  discoverSessionFiles(scanMode: "ancestor-only" | "repo-sessions"): Promise<string[]>;
}

interface LedgerDeps {
  pi: ExtensionAPI;
  state: RewindRuntimeState;
  store: SnapshotStore;
  updateStatus: (ctx: ExtensionContext) => void;
}

export function createLedgerManager(pi: ExtensionAPI, state: RewindRuntimeState, store: SnapshotStore, updateStatus: (ctx: ExtensionContext) => void): LedgerManager {
  const deps = { pi, state, store, updateStatus };
  return {
    appendRewindTurn: (ctx, collector) => appendRewindTurn(deps, ctx, collector),
    appendRewindOp: (ctx, data) => appendRewindOp(deps, ctx, data),
    appendForkPendingState: (data) => appendForkPendingState(deps, data),
    bindPendingPromptUser: (entries, collector) => bindPendingPromptUser(deps, entries, collector),
    buildCurrentSessionLedger: (ctx) => buildCurrentSessionLedger(deps, ctx),
    buildCurrentSessionLedgerFromMemory: () => buildCurrentSessionLedgerFromMemory(state),
    parseSessionLedgerFile: (sessionFile) => parseSessionLedgerFile(deps, sessionFile),
    resolveEntrySnapshotWithLineage: (entryId, sessionFile) => resolveEntrySnapshotWithLineage(deps, entryId, sessionFile),
    reconstructState: (ctx) => reconstructState(deps, ctx),
    discoverSessionFiles: (scanMode) => discoverSessionFiles(deps, scanMode),
  };
}

function appendRewindTurn(deps: LedgerDeps, ctx: ExtensionContext, collector: ActivePromptCollector): void {
  if (collector.bindings.length === 0) return;
  const data: RewindTurnData = { v: RETENTION_VERSION, snapshots: collector.snapshots, bindings: collector.bindings };
  deps.pi.appendEntry("rewind-turn", data);
  applyBindings(deps.state.entryToCommit, data.snapshots, data.bindings);
  const latestBinding = data.bindings[data.bindings.length - 1];
  if (latestBinding) {
    deps.state.activeBranchState.currentCommitSha = data.snapshots[latestBinding[1]];
    deps.state.activeBranchState.currentTreeSha = deps.state.lastExact?.commitSha === deps.state.activeBranchState.currentCommitSha ? deps.state.lastExact.treeSha : undefined;
  }
  deps.updateStatus(ctx);
}

function appendRewindOp(deps: LedgerDeps, ctx: ExtensionContext, data: RewindOpData): void {
  if (!data.bindings?.length && typeof data.current !== "number" && typeof data.undo !== "number") return;
  deps.pi.appendEntry("rewind-op", data);
  applyBindings(deps.state.entryToCommit, data.snapshots, data.bindings);
  const currentCommitSha = getCommitFromData(data, "current");
  if (currentCommitSha) {
    deps.state.activeBranchState.currentCommitSha = currentCommitSha;
    deps.state.activeBranchState.currentTreeSha = deps.state.lastExact?.commitSha === currentCommitSha ? deps.state.lastExact.treeSha : undefined;
  }
  const undoCommitSha = getCommitFromData(data, "undo");
  if (undoCommitSha) deps.state.activeBranchState.undoCommitSha = undoCommitSha;
  deps.updateStatus(ctx);
}

function appendForkPendingState(deps: LedgerDeps, data: PendingResultingState): void {
  const forkPending: RewindForkPendingData = { v: RETENTION_VERSION, current: data.currentCommitSha };
  if (data.undoCommitSha) forkPending.undo = data.undoCommitSha;
  deps.pi.appendEntry("rewind-fork-pending", forkPending);
}

function bindPendingPromptUser(_deps: LedgerDeps, entries: SessionLikeEntry[], collector: ActivePromptCollector): void {
  if (!collector.pendingUserCommitSha) return;
  const userEntry = findMatchingUserEntry(entries, collector.promptText) ?? findLatestUserEntry(entries);
  if (!userEntry) return;
  if (collector.bindings.some(([entryId]) => entryId === userEntry.id)) {
    collector.pendingUserCommitSha = undefined;
    return;
  }
  addBindingToCollector(collector, userEntry.id, collector.pendingUserCommitSha);
  collector.pendingUserCommitSha = undefined;
}

function buildCurrentSessionLedger(deps: LedgerDeps, ctx: ExtensionContext): ParsedSessionLedger {
  const ledger: ParsedSessionLedger = {
    sessionFile: deps.state.currentSessionFile ?? "",
    sessionId: ctx.sessionManager.getSessionId(),
    cwd: ctx.sessionManager.getCwd(),
    parentSession: ctx.sessionManager.getHeader()?.parentSession,
    entryToCommit: new Map(),
    labeledEntryIds: new Set(),
    references: [],
  };
  applyEntriesToLedger(ledger, ctx.sessionManager.getEntries() as SessionLikeEntry[]);
  return ledger;
}

function buildCurrentSessionLedgerFromMemory(state: RewindRuntimeState): ParsedSessionLedger {
  return {
    sessionFile: state.currentSessionFile ?? "",
    sessionId: state.sessionId ?? undefined,
    cwd: state.currentSessionCwd,
    parentSession: state.currentParentSession,
    entryToCommit: new Map(state.entryToCommit),
    labeledEntryIds: new Set(),
    references: [],
    latestCurrentCommitSha: state.activeBranchState.currentCommitSha,
    latestUndoCommitSha: state.activeBranchState.undoCommitSha,
  };
}

async function parseSessionLedgerFile(deps: LedgerDeps, sessionFile: string): Promise<ParsedSessionLedger | null> {
  try {
    const fileStat = await stat(sessionFile);
    const cached = deps.state.parsedSessionCache.get(sessionFile);
    if (cached?.mtimeMs === fileStat.mtimeMs) return cached.ledger;
    const ledger = parseSessionLedgerContent(sessionFile, await readFile(sessionFile, "utf8"));
    deps.state.parsedSessionCache.set(sessionFile, { mtimeMs: fileStat.mtimeMs, ledger });
    return ledger;
  } catch {
    return null;
  }
}

async function resolveEntrySnapshotWithLineage(deps: LedgerDeps, entryId: string, sessionFile = deps.state.currentSessionFile): Promise<string | undefined> {
  let cursor = sessionFile;
  while (cursor) {
    const ledger = cursor === deps.state.currentSessionFile ? buildCurrentSessionLedgerFromMemory(deps.state) : await parseSessionLedgerFile(deps, cursor);
    if (!ledger) break;
    const commitSha = ledger.entryToCommit.get(entryId);
    if (commitSha && await deps.store.commitExists(commitSha)) return commitSha;
    cursor = ledger.parentSession ?? undefined;
  }
  return undefined;
}

async function reconstructState(deps: LedgerDeps, ctx: ExtensionContext): Promise<void> {
  deps.state.entryToCommit.clear();
  deps.state.activeBranchState = {};
  deps.state.lastExact = null;
  const currentLedger = buildCurrentSessionLedger(deps, ctx);
  for (const [entryId, commitSha] of currentLedger.entryToCommit) deps.state.entryToCommit.set(entryId, commitSha);
  let latestVisibleBindingCommitSha: string | undefined;
  for (const entry of ctx.sessionManager.getBranch() as SessionLikeEntry[]) {
    const boundCommitSha = entry.id ? deps.state.entryToCommit.get(entry.id) : undefined;
    if (boundCommitSha && isRestorableTreeEntry(entry)) latestVisibleBindingCommitSha = boundCommitSha;
    if (entry.type !== "custom" || entry.customType !== "rewind-op" || !isRewindOpData(entry.data)) continue;
    deps.state.activeBranchState.currentCommitSha = getCommitFromData(entry.data, "current") ?? deps.state.activeBranchState.currentCommitSha;
    deps.state.activeBranchState.undoCommitSha = getCommitFromData(entry.data, "undo") ?? deps.state.activeBranchState.undoCommitSha;
  }
  deps.state.activeBranchState.currentCommitSha ??= latestVisibleBindingCommitSha;
  await setCurrentTreeIfReachable(deps);
}

async function setCurrentTreeIfReachable(deps: LedgerDeps): Promise<void> {
  const commitSha = deps.state.activeBranchState.currentCommitSha;
  if (!commitSha || !await deps.store.commitExists(commitSha)) return;
  deps.state.activeBranchState.currentTreeSha = await deps.store.getCommitTreeSha(commitSha);
  const { treeSha } = await deps.store.captureWorktreeTree();
  if (deps.state.activeBranchState.currentTreeSha === treeSha) deps.state.lastExact = { commitSha, treeSha };
}

async function discoverSessionFiles(deps: LedgerDeps, scanMode: "ancestor-only" | "repo-sessions"): Promise<string[]> {
  const discovered = new Set<string>();
  if (scanMode === "repo-sessions") await collectSessionFiles(discovered, [getDefaultSessionsDir(), deps.state.currentSessionFile ? dirname(deps.state.currentSessionFile) : ""]);
  let cursor = deps.state.currentSessionFile;
  while (cursor) {
    discovered.add(cursor);
    const ledger = cursor === deps.state.currentSessionFile ? buildCurrentSessionLedgerFromMemory(deps.state) : await parseSessionLedgerFile(deps, cursor);
    cursor = ledger?.parentSession ?? undefined;
  }
  return [...discovered];
}

function applyEntriesToLedger(ledger: ParsedSessionLedger, entries: SessionLikeEntry[]): void {
  for (const rawEntry of entries) {
    if (rawEntry.type === "custom") applyCustomEntry(ledger, rawEntry as Extract<SessionLikeEntry, { type: "custom" }>);
    if (isSessionLikeLabelEntry(rawEntry)) updateLabel(ledger, rawEntry);
  }
}

function applyCustomEntry(ledger: ParsedSessionLedger, entry: Extract<SessionLikeEntry, { type: "custom" }>): void {
  const timestamp = toTimestamp(entry.timestamp);
  if (entry.customType === "rewind-turn" && isRewindTurnData(entry.data)) {
    applyBindings(ledger.entryToCommit, entry.data.snapshots, entry.data.bindings);
    addReferences(ledger.references, entry.data.snapshots, timestamp, entry.data);
  } else if (entry.customType === "rewind-op" && isRewindOpData(entry.data)) {
    applyBindings(ledger.entryToCommit, entry.data.snapshots, entry.data.bindings);
    addReferences(ledger.references, entry.data.snapshots, timestamp, entry.data);
    ledger.latestCurrentCommitSha = getCommitFromData(entry.data, "current") ?? ledger.latestCurrentCommitSha;
    ledger.latestUndoCommitSha = getCommitFromData(entry.data, "undo") ?? ledger.latestUndoCommitSha;
  } else if (entry.customType === "rewind-fork-pending" && isRewindForkPendingData(entry.data)) {
    ledger.latestForkPending = entry.data;
  }
}

function updateLabel(ledger: ParsedSessionLedger, entry: SessionLikeLabelEntry): void {
  if (!entry.targetId) return;
  if (entry.label?.trim()) ledger.labeledEntryIds.add(entry.targetId);
  else ledger.labeledEntryIds.delete(entry.targetId);
}

export function parseSessionLedgerContent(sessionFile: string, content: string): ParsedSessionLedger {
  if (!content.includes("\"rewind-")) return parseSessionHeader(sessionFile, content);
  const ledger: ParsedSessionLedger = { sessionFile, entryToCommit: new Map(), labeledEntryIds: new Set(), references: [] };
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const entry = parseJsonObject(line);
    if (!entry) continue;
    if (entry.type === "session") applySessionHeader(ledger, entry);
    else applyRawLedgerEntry(ledger, entry);
  }
  return ledger;
}

function parseSessionHeader(sessionFile: string, content: string): ParsedSessionLedger {
  const ledger: ParsedSessionLedger = { sessionFile, entryToCommit: new Map(), labeledEntryIds: new Set(), references: [] };
  for (const line of content.split("\n").slice(0, 5)) {
    const entry = parseJsonObject(line);
    if (entry?.type !== "session") continue;
    applySessionHeader(ledger, entry);
    break;
  }
  return ledger;
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function applySessionHeader(ledger: ParsedSessionLedger, entry: Record<string, unknown>): void {
  if (typeof entry.id === "string") ledger.sessionId = entry.id;
  if (typeof entry.cwd === "string") ledger.cwd = entry.cwd;
  if (typeof entry.parentSession === "string" || entry.parentSession === null) ledger.parentSession = entry.parentSession ?? undefined;
}

function applyRawLedgerEntry(ledger: ParsedSessionLedger, entry: Record<string, unknown>): void {
  const timestamp = toTimestamp(typeof entry.timestamp === "string" ? entry.timestamp : undefined);
  const data = entry.data;
  if (entry.type === "custom" && entry.customType === "rewind-turn" && isRewindTurnData(data)) {
    applyBindings(ledger.entryToCommit, data.snapshots, data.bindings);
    addReferences(ledger.references, data.snapshots, timestamp, data);
  } else if (entry.type === "custom" && entry.customType === "rewind-op" && isRewindOpData(data)) {
    applyBindings(ledger.entryToCommit, data.snapshots, data.bindings);
    addReferences(ledger.references, data.snapshots, timestamp, data);
    ledger.latestCurrentCommitSha = getCommitFromData(data, "current") ?? ledger.latestCurrentCommitSha;
    ledger.latestUndoCommitSha = getCommitFromData(data, "undo") ?? ledger.latestUndoCommitSha;
  } else if (entry.type === "custom" && entry.customType === "rewind-fork-pending" && isRewindForkPendingData(data)) {
    ledger.latestForkPending = data;
  } else if (isSessionLikeLabelEntry(entry)) updateLabel(ledger, entry);
}

async function collectSessionFiles(target: Set<string>, roots: string[]): Promise<void> {
  const stack = roots.filter((root) => root && existsSync(root));
  while (stack.length) {
    const directory = stack.pop();
    if (!directory) continue;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) target.add(path);
    }
  }
}

function findLatestUserEntry(entries: SessionLikeEntry[]): SessionLikeMessageEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === "message" && entry.message?.role === "user") return entry as SessionLikeMessageEntry;
  }
  return null;
}

function findMatchingUserEntry(entries: SessionLikeEntry[], promptText?: string): SessionLikeMessageEntry | null {
  if (!promptText) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === "message" && entry.message?.role === "user" && getTextContent(entry.message.content) === promptText) return entry as SessionLikeMessageEntry;
  }
  return null;
}
