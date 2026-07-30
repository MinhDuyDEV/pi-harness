import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { DcpKnowledgeReferences } from "./knowledge-port.js";
import { emptyDcpKnowledgeReferences, isDcpKnowledgeReferences } from "./knowledge-port.js";
import type { DcpProvenanceV2, LegacyAttestationMetadata, QuarantinedBlock } from "./compress-types.ts";

export interface DurableCompressionBlock {
  id: string;
  topic: string;
  summary: string;
  filesRead: string[];
  filesModified: string[];
  decisions: string[];
  nextSteps: string[];
  createdAt: number;
  startMessageId?: string;
  endMessageId?: string;
  beadId?: string;
  source?: string;
      /** V2: provenance metadata captured at block creation time */
      provenance?: DcpProvenanceV2;
      /** Attestation metadata when a legacy block has been attested */
      attestation?: LegacyAttestationMetadata;
    }

export interface DurableArtifact {
  path: string;
  lastSeen: number;
  accessCount: number;
  toolName: string;
  wasCompressed: boolean;
}

export interface DurableSessionState {
  version: 1 | 2;
  sessionId: string;
  sessionKey: string;
  blocks: DurableCompressionBlock[];
  artifacts: DurableArtifact[];
  persistentSummary?: unknown;
  processedMessageIds: string[];
  lastDigest?: string;
  compressEventCount: number;
  lastCompressTurn: number;
  updatedAt: number;
  /** V2: Quarantined blocks that failed provenance validation */
  quarantinedBlocks?: QuarantinedBlock[];
  /** V2 extension: non-content learning, usage, and checkpoint references. */
  knowledgeReferences?: DcpKnowledgeReferences;
}

export interface DurableSessionInfo {
  path: string;
  sessionId: string;
  sessionKey: string;
  updatedAt: number;
}

const DCP_STATE_DIR = join(homedir(), ".pi", "agent", "dcp-state");

function ensureStateDir(): void {
  mkdirSync(DCP_STATE_DIR, { recursive: true });
}

export function getSessionKey(sessionId: string): string {
  return createHash("sha256")
    .update(sessionId || "default")
    .digest("hex")
    .slice(0, 24);
}

function getSessionStatePath(sessionId: string): string {
  return join(DCP_STATE_DIR, `${getSessionKey(sessionId)}.json`);
}

function migrateDurableSessionState(value: unknown): DurableSessionState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const parsed = value as Partial<DurableSessionState>;
  if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.blocks)) return undefined;
  const knowledgeReferences = isDcpKnowledgeReferences(parsed.knowledgeReferences)
    ? parsed.knowledgeReferences
    : emptyDcpKnowledgeReferences();
  const blocks = parsed.blocks.map((block) => ({
    ...block,
    filesRead: Array.isArray(block.filesRead) ? block.filesRead : [],
    filesModified: Array.isArray(block.filesModified) ? block.filesModified : [],
    decisions: Array.isArray(block.decisions) ? block.decisions : [],
    nextSteps: Array.isArray(block.nextSteps) ? block.nextSteps : [],
  }));
  return {
    ...parsed,
    blocks,
    version: 2,
    knowledgeReferences,
  } as DurableSessionState;
}

export function loadDurableSessionStateFromPath(path: string): DurableSessionState | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return migrateDurableSessionState(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    // A truncated primary checkpoint is not usable; its previous atomic state
    // remains the recovery boundary for callers that retain one.
    return undefined;
  }
}

export function loadDurableSessionState(sessionId: string): DurableSessionState | undefined {
  return loadDurableSessionStateFromPath(getSessionStatePath(sessionId));
}

export function saveDurableSessionStateToPath(
  state: DurableSessionState,
  path: string,
): void {
  ensureStateDir();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const payload = JSON.stringify(
    {
      ...state,
      version: 2,
      knowledgeReferences: isDcpKnowledgeReferences(state.knowledgeReferences)
        ? state.knowledgeReferences
        : emptyDcpKnowledgeReferences(),
      updatedAt: Date.now(),
    },
    null,
    2,
  );
  try {
    const fd = openSync(tmp, "w", 0o600);
    try {
      const buffer = Buffer.from(payload, "utf8");
      let offset = 0;
      while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
    const directoryFd = openSync(dirname(path), "r");
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

export function saveDurableSessionState(state: DurableSessionState): void {
  ensureStateDir();
  saveDurableSessionStateToPath(state, getSessionStatePath(state.sessionId));
}

export function deleteDurableSessionState(sessionId: string): void {
  rmSync(getSessionStatePath(sessionId), { force: true });
}

export function listDurableSessionStates(): DurableSessionInfo[] {
  ensureStateDir();
  return readdirSync(DCP_STATE_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const path = join(DCP_STATE_DIR, name);
      try {
        const parsed = JSON.parse(
          readFileSync(path, "utf8"),
        ) as DurableSessionState;
        return {
          path,
          sessionId: parsed.sessionId ?? "",
          sessionKey: parsed.sessionKey ?? name.replace(/\.json$/, ""),
          updatedAt: parsed.updatedAt ?? statSync(path).mtimeMs,
        };
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is DurableSessionInfo => Boolean(entry))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
