import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export const STORE_REF = "refs/pi-rewind/store";
export const STATUS_KEY = "rewind";
export const FORK_PREFERENCE_SOURCE_ALLOWLIST = new Set(["fork-from-first"]);
export const CHECKPOINT_SOURCE_ALLOWLIST = new Set(["pi-custom-compaction"]);
export const LEGACY_ZERO_SHA = "0000000000000000000000000000000000000000";
export const RETENTION_SWEEP_THRESHOLD = 50;
export const RETENTION_VERSION = 2;
export const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export type ExecFn = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>;
export type GitExecResult = Awaited<ReturnType<ExecFn>>;
export type BindingTuple = [entryId: string, snapshotIndex: number];

export interface RewindSettings {
  rewind?: {
    silentCheckpoints?: boolean;
    retention?: {
      maxSnapshots?: number;
      maxAgeDays?: number;
      pinLabeledEntries?: boolean;
      scanMode?: "ancestor-only" | "repo-sessions";
      startupBudgetMs?: number;
    };
  };
}

export type RewindRetentionSettings = NonNullable<NonNullable<RewindSettings["rewind"]>["retention"]>;

export interface RewindTurnData {
  v: 2;
  snapshots: string[];
  bindings: BindingTuple[];
}

export interface RewindOpData {
  v: 2;
  snapshots: string[];
  bindings?: BindingTuple[];
  current?: number;
  undo?: number;
}

export interface RewindForkPendingData {
  v: 2;
  current: string;
  undo?: string;
}

export interface ActivePromptCollector {
  snapshots: string[];
  bindings: BindingTuple[];
  promptText?: string;
  pendingUserCommitSha?: string;
}

export interface ExactState {
  commitSha: string;
  treeSha: string;
}

export interface ActiveBranchState {
  currentCommitSha?: string;
  currentTreeSha?: string;
  undoCommitSha?: string;
}

export interface PendingResultingState {
  currentCommitSha: string;
  undoCommitSha?: string;
}

export interface RewindRuntimeState {
  entryToCommit: Map<string, string>;
  parsedSessionCache: Map<string, { mtimeMs: number; ledger: ParsedSessionLedger }>;
  repoRoot: string | null;
  sessionId: string | null;
  currentSessionFile?: string;
  currentParentSession?: string;
  currentSessionCwd?: string;
  isGitRepo: boolean;
  lastExact: ExactState | null;
  activeBranchState: ActiveBranchState;
  promptCollector: ActivePromptCollector | null;
  pendingTreeState: PendingResultingState | null;
  activePromptText: string | null;
  newSnapshotsSinceSweep: number;
  sweepRunning: boolean;
  sweepCompletedThisSession: boolean;
  forceConversationOnlyOnNextFork: boolean;
  forceConversationOnlySource: string | null;
}

export function createRewindRuntimeState(): RewindRuntimeState {
  return {
    entryToCommit: new Map(),
    parsedSessionCache: new Map(),
    repoRoot: null,
    sessionId: null,
    isGitRepo: false,
    lastExact: null,
    activeBranchState: {},
    promptCollector: null,
    pendingTreeState: null,
    activePromptText: null,
    newSnapshotsSinceSweep: 0,
    sweepRunning: false,
    sweepCompletedThisSession: false,
    forceConversationOnlyOnNextFork: false,
    forceConversationOnlySource: null,
  };
}

export interface ParsedLedgerReference {
  commitSha: string;
  entryId?: string;
  timestamp: number;
  kind: "binding" | "current" | "undo";
}

export interface ParsedSessionLedger {
  sessionFile: string;
  sessionId?: string;
  cwd?: string;
  parentSession?: string | null;
  entryToCommit: Map<string, string>;
  labeledEntryIds: Set<string>;
  references: ParsedLedgerReference[];
  latestCurrentCommitSha?: string;
  latestUndoCommitSha?: string;
  latestForkPending?: RewindForkPendingData;
}

export interface SessionLikeMessageEntry {
  type: "message";
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: { role?: string; timestamp?: number; content?: unknown };
}

export interface SessionLikeLabelEntry {
  type: "label";
  id: string;
  parentId: string | null;
  timestamp: string;
  targetId?: string;
  label?: string | null;
}

export interface SessionLikeCustomEntry {
  type: "custom";
  id: string;
  parentId: string | null;
  timestamp: string;
  customType: string;
  data?: unknown;
}

export interface SessionLikeBranchSummaryEntry {
  type: "branch_summary";
  id: string;
}

export type SessionLikeEntry =
  | SessionLikeMessageEntry
  | SessionLikeCustomEntry
  | SessionLikeLabelEntry
  | SessionLikeBranchSummaryEntry
  | {
      type: string;
      id: string;
      parentId: string | null;
      timestamp: string;
      message?: { role?: string; content?: unknown; timestamp?: number };
      customType?: string;
      data?: unknown;
      targetId?: string;
      label?: string | null;
    };

let cachedSettings: RewindSettings | null = null;

export function resetSettingsCache(): void {
  cachedSettings = null;
}

export function getDefaultSessionsDir(): string {
  return join(getAgentDir(), "sessions");
}

function getSettings(): RewindSettings {
  if (cachedSettings) return cachedSettings;
  try {
    cachedSettings = JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf8")) as RewindSettings;
  } catch {
    cachedSettings = {};
  }
  return cachedSettings;
}

export function getSilentCheckpointsSetting(): boolean {
  return getSettings().rewind?.silentCheckpoints === true;
}

export function getRetentionSettings(): RewindRetentionSettings | undefined {
  return getSettings().rewind?.retention;
}

export function getRetentionScanMode(): "ancestor-only" | "repo-sessions" {
  return getRetentionSettings()?.scanMode === "repo-sessions" ? "repo-sessions" : "ancestor-only";
}

export function getStartupSweepBudgetMs(): number | undefined {
  const value = getRetentionSettings()?.startupBudgetMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function isRewindTurnData(value: unknown): value is RewindTurnData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<RewindTurnData>;
  return data.v === 2 && Array.isArray(data.snapshots) && Array.isArray(data.bindings);
}

export function isRewindOpData(value: unknown): value is RewindOpData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<RewindOpData>;
  return data.v === 2 && Array.isArray(data.snapshots);
}

export function isRewindForkPendingData(value: unknown): value is RewindForkPendingData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<RewindForkPendingData>;
  return data.v === 2 && typeof data.current === "string" && data.current.length > 0;
}

export function isSessionLikeLabelEntry(entry: unknown): entry is SessionLikeLabelEntry {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as Record<string, unknown>;
  if (candidate.type !== "label" || typeof candidate.id !== "string" || typeof candidate.timestamp !== "string") return false;
  if (candidate.parentId !== null && typeof candidate.parentId !== "string") return false;
  if (candidate.targetId !== undefined && typeof candidate.targetId !== "string") return false;
  return candidate.label === undefined || candidate.label === null || typeof candidate.label === "string";
}

export function canonicalizePath(value: string): string {
  const resolved = resolve(value);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function isInsidePath(targetPath: string, parentPath: string): boolean {
  const rel = relative(canonicalizePath(parentPath), canonicalizePath(targetPath));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function toTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text?: string } => !!block && typeof block === "object")
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

export function updateLabelSet(labelIds: Set<string>, entry: SessionLikeLabelEntry): void {
  if (!entry.targetId) return;
  if (entry.label?.trim()) labelIds.add(entry.targetId);
  else labelIds.delete(entry.targetId);
}

export function applyBindings(target: Map<string, string>, snapshots: string[], bindings?: BindingTuple[]): void {
  if (!bindings) return;
  for (const [entryId, snapshotIndex] of bindings) {
    const commitSha = snapshots[snapshotIndex];
    if (entryId && commitSha) target.set(entryId, commitSha);
  }
}

export function addReferences(target: ParsedLedgerReference[], snapshots: string[], timestamp: number, data: RewindTurnData | RewindOpData): void {
  if ("bindings" in data && data.bindings) {
    for (const [entryId, snapshotIndex] of data.bindings) {
      const commitSha = snapshots[snapshotIndex];
      if (commitSha) target.push({ commitSha, entryId, timestamp, kind: "binding" });
    }
  }
  if ("current" in data && typeof data.current === "number") {
    const commitSha = snapshots[data.current];
    if (commitSha) target.push({ commitSha, timestamp, kind: "current" });
  }
  if ("undo" in data && typeof data.undo === "number") {
    const commitSha = snapshots[data.undo];
    if (commitSha) target.push({ commitSha, timestamp, kind: "undo" });
  }
}

function resolveBindingSnapshotIndex(snapshots: string[], commitSha: string): number {
  const existingIndex = snapshots.indexOf(commitSha);
  if (existingIndex >= 0) return existingIndex;
  snapshots.push(commitSha);
  return snapshots.length - 1;
}

export function addBindingToCollector(collector: ActivePromptCollector, entryId: string, commitSha: string): void {
  collector.bindings.push([entryId, resolveBindingSnapshotIndex(collector.snapshots, commitSha)]);
}

export function getCommitFromData(data: RewindOpData, key: "current" | "undo"): string | undefined {
  const index = data[key];
  return typeof index === "number" ? data.snapshots[index] : undefined;
}

export function isRestorableTreeEntry(entry: SessionLikeEntry | undefined): boolean {
  if (!entry) return false;
  if (entry.type === "message") return entry.message?.role === "user" || entry.message?.role === "assistant";
  return entry.type === "branch_summary" || entry.type === "compaction" || entry.type === "custom_message";
}

export function findLatestUserMessageEntry(entries: SessionLikeEntry[]): SessionLikeMessageEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === "message" && entry.message?.role === "user") return entry as SessionLikeMessageEntry;
  }
  return null;
}

export function findLatestMatchingUserMessageEntry(entries: SessionLikeEntry[], promptText: string | null | undefined): SessionLikeMessageEntry | null {
  if (!promptText) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === "message" && entry.message?.role === "user" && getTextContent(entry.message.content) === promptText) {
      return entry as SessionLikeMessageEntry;
    }
  }
  return null;
}

export function findAssistantEntryForTurn(entries: SessionLikeEntry[], message: { timestamp?: number; content?: unknown }): SessionLikeMessageEntry | null {
  const targetText = getTextContent(message.content);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    if (message.timestamp !== undefined && entry.message.timestamp === message.timestamp) return entry as SessionLikeMessageEntry;
    if (targetText && getTextContent(entry.message.content) === targetText) return entry as SessionLikeMessageEntry;
  }
  return null;
}

export function rewindDebug(...args: unknown[]): void {
  if (process.env.PI_REWIND_DEBUG === "1") console.warn("[rewind-debug]", ...args);
}
