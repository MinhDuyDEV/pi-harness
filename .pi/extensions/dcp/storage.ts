import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
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

export function loadDurableSessionState(
  sessionId: string,
): DurableSessionState | undefined {
  const path = getSessionStatePath(sessionId);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(
      readFileSync(path, "utf8"),
    ) as DurableSessionState;
    if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.blocks)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function saveDurableSessionState(state: DurableSessionState): void {
  ensureStateDir();
  const path = getSessionStatePath(state.sessionId);
  const tmp = `${path}.tmp`;
  writeFileSync(
    tmp,
    JSON.stringify({ ...state, updatedAt: Date.now() }, null, 2),
  );
  renameSync(tmp, path);
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

export function loadDurableSessionStateFromPath(
  path: string,
): DurableSessionState | undefined {
  try {
    const parsed = JSON.parse(
      readFileSync(path, "utf8"),
    ) as DurableSessionState;
    if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.blocks)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}
