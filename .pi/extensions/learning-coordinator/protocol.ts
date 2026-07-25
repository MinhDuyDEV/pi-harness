import { createHash } from "node:crypto";

export const LEARNING_OBSERVATION_EVENT = "pi-learning:observation:v1";
export const KNOWLEDGE_SIGNAL_EVENT = "pi-harness:knowledge-signal:v1";
export const SUBAGENT_CONTEXT_REQUEST_EVENT = "pi-subagents:v1:context-request";
export const SUBAGENT_PROOF_EVENT = "pi-subagents:v1:proof-verified";
export const SUBAGENT_REVIEW_EVENT = "pi-subagents:v1:review-completed";
export const TODO_ITEM_EVENT = "pi-todo:item-completed:v1";
export const TODO_PHASE_EVENT = "pi-todo:phase-closed:v1";
export const DCP_TELEMETRY_EVENT = "dcp:telemetry";

const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_DESCRIPTION = 300;
const SECRET = /(ghp_[a-z0-9]{20,}|sk-[a-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|BEGIN [A-Z ]*PRIVATE KEY|ignore (all |any )?(previous|prior) instructions)/i;

export interface ContextRequestV1 {
  protocolVersion: 1;
  taskId: string;
  agentType: string;
  description: string;
  response?: unknown;
}

export interface ProofVerifiedV1 {
  protocolVersion: 1;
  taskId: string;
  verificationPassed: boolean;
  verificationIssues: readonly string[];
  evidenceDigests: readonly string[];
  timestamp: string;
}

export interface LearningObservationV1 {
  kind: "pattern" | "discovery";
  content: string;
  projectKey: string;
  source: string;
  evidenceRefs: Array<{
    id: string;
    digest: string;
    trust: "verified-command";
    description: string;
  }>;
  context: string;
  timestamp: number;
  idempotencyKey: string;
}

export interface KnowledgeSignalV1 {
  schema: "pi-harness.knowledge-signal/v1";
  type: "todo-item-completed" | "todo-phase-closed" | "dcp-compaction" | "review-completed";
  idempotencyKey: string;
  occurredAt: string;
  source: string;
  references: readonly string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function bounded(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length === 0 || normalized.length > max || SECRET.test(normalized)) return undefined;
  return normalized;
}

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function projectKey(cwd: string): string {
  return `project:${digest(cwd)}`;
}

export function parseContextRequest(value: unknown): ContextRequestV1 | undefined {
  const input = record(value);
  if (!input || input.protocolVersion !== 1) return undefined;
  const taskId = bounded(input.taskId, 128);
  const agentType = bounded(input.agentType, 64);
  const description = bounded(input.description, MAX_DESCRIPTION);
  if (!taskId || !agentType || !description) return undefined;
  return { protocolVersion: 1, taskId, agentType, description };
}

export function parseProof(value: unknown): ProofVerifiedV1 | undefined {
  const input = record(value);
  if (!input || input.protocolVersion !== 1 || typeof input.verificationPassed !== "boolean") return undefined;
  const taskId = bounded(input.taskId, 128);
  const timestamp = bounded(input.timestamp, 40);
  if (!taskId || !timestamp || !Array.isArray(input.evidenceDigests) || !Array.isArray(input.verificationIssues)) return undefined;
  const evidenceDigests = input.evidenceDigests
    .filter((item): item is string => typeof item === "string" && SHA256.test(item))
    .slice(0, 20)
    .map((item) => item.toLowerCase());
  const verificationIssues = input.verificationIssues
    .map((item) => bounded(item, 300))
    .filter((item): item is string => item !== undefined)
    .slice(0, 10);
  return { protocolVersion: 1, taskId, verificationPassed: input.verificationPassed, verificationIssues, evidenceDigests, timestamp };
}

export function createObservation(
  request: ContextRequestV1,
  proof: ProofVerifiedV1,
  cwd: string,
): LearningObservationV1 | undefined {
  if (!proof.verificationPassed || proof.evidenceDigests.length === 0) return undefined;
  const idempotencyKey = digest(`${request.taskId}\0${proof.evidenceDigests.join(",")}`);
  return {
    kind: "pattern",
    content: request.description,
    projectKey: projectKey(cwd),
    source: "pi-subagents:proof-verified",
    evidenceRefs: proof.evidenceDigests.map((evidenceDigest, index) => ({
      id: `task:${request.taskId}:evidence:${index}`,
      digest: evidenceDigest,
      trust: "verified-command",
      description: "Verified task evidence receipt",
    })),
    context: request.agentType,
    timestamp: Date.parse(proof.timestamp),
    idempotencyKey,
  };
}
