import { createHash } from "node:crypto";

export const PROTOCOL_VERSION = 1 as const;
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
const MAX_TIMESTAMP = 40;
const SECRET_PATTERNS = [
  /-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gi,
  /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{12,}/gi,
  /\b(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|passwd|secret)\s*[:=]\s*[^\s,;]+/gi,
  /\b(?:gh[pousr]_|sk-|xox[baprs]-)[a-z0-9_-]{12,}/gi,
  /\bAKIA[A-Z0-9]{16}\b/gi,
  /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi,
  /\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|earlier)\s+instructions\b/gi,
];

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
  protocolVersion: 1;
  kind: "pattern" | "discovery";
  confidence: "high";
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
  digest: string;
  idempotencyKey: string;
}

/**
 * Kept as a data adapter only. There is no registered knowledge-signal relay
 * until pi-learning ships a bounded consumer for this contract.
 */
export interface KnowledgeSignalV1 {
  protocolVersion: 1;
  type: "todo-item-completed" | "todo-phase-closed" | "dcp-compaction" | "review-completed";
  idempotencyKey: string;
  occurredAt: string;
  source: string;
  confidence: "high";
  digest: string;
  references: readonly string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function clean(value: string): string {
  return SECRET_PATTERNS.reduce((result, pattern) => result.replace(pattern, "[REDACTED]"), value);
}

export function sanitizeText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = clean(value.normalize("NFKC")).trim();
  if (normalized.length === 0 || normalized.length > max) return undefined;
  return normalized;
}

function boundedIdentifier(value: unknown, max: number): string | undefined {
  const normalized = sanitizeText(value, max);
  return normalized && !normalized.includes("[REDACTED]") ? normalized : undefined;
}

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function projectKey(cwd: string): string {
  return `project:${digest(cwd)}`;
}

/** Stable, bounded identity for JSON-safe event payloads, including numeric timestamps. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const input = record(value);
  if (input) {
    return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${canonical(input[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function stableEventIdentity(source: string, payload: unknown): string | undefined {
  const input = record(payload);
  if (!input || typeof input.type !== "string" || !Number.isSafeInteger(input.timestamp)) return undefined;
  return digest(`${source}\0${canonical(input)}`);
}

export function knowledgeSignalFromEvent(
  type: KnowledgeSignalV1["type"],
  source: string,
  payload: unknown,
): KnowledgeSignalV1 | undefined {
  const input = record(payload);
  const identity = stableEventIdentity(source, payload);
  if (!input || !identity) return undefined;
  const timestamp = input.timestamp as number;
  const references = [input.todoRef, input.docDigest, input.subjectDigest, input.taskId]
    .map((value) => boundedIdentifier(value, 128))
    .filter((value): value is string => value !== undefined)
    .slice(0, 8);
  const occurredAt = new Date(timestamp).toISOString();
  return {
    protocolVersion: PROTOCOL_VERSION,
    type,
    idempotencyKey: identity,
    occurredAt,
    source,
    confidence: "high",
    digest: digest(JSON.stringify({ type, timestamp, outcome: input.outcome ?? null })),
    references,
  };
}

export function parseContextRequest(value: unknown): ContextRequestV1 | undefined {
  const input = record(value);
  if (!input || input.protocolVersion !== PROTOCOL_VERSION) return undefined;
  const taskId = boundedIdentifier(input.taskId, 128);
  const agentType = boundedIdentifier(input.agentType, 64);
  const description = sanitizeText(input.description, MAX_DESCRIPTION);
  if (!taskId || !agentType || !description) return undefined;
  return { protocolVersion: PROTOCOL_VERSION, taskId, agentType, description };
}

export function parseProof(value: unknown): ProofVerifiedV1 | undefined {
  const input = record(value);
  if (!input || input.protocolVersion !== PROTOCOL_VERSION || typeof input.verificationPassed !== "boolean") return undefined;
  const taskId = boundedIdentifier(input.taskId, 128);
  const timestamp = boundedIdentifier(input.timestamp, MAX_TIMESTAMP);
  if (!taskId || !timestamp || !Number.isFinite(Date.parse(timestamp)) || !Array.isArray(input.evidenceDigests) || !Array.isArray(input.verificationIssues)) return undefined;
  if (input.evidenceDigests.some((item) => typeof item !== "string" || !SHA256.test(item))) return undefined;
  const evidenceDigests = input.evidenceDigests
    .slice(0, 20)
    .map((item) => (item as string).toLowerCase());
  const verificationIssues = input.verificationIssues
    .map((item) => sanitizeText(item, 300))
    .filter((item): item is string => item !== undefined)
    .slice(0, 10);
  return { protocolVersion: PROTOCOL_VERSION, taskId, verificationPassed: input.verificationPassed, verificationIssues, evidenceDigests, timestamp };
}

export function createObservation(
  request: ContextRequestV1,
  proof: ProofVerifiedV1,
  cwd: string,
): LearningObservationV1 | undefined {
  const content = sanitizeText(request.description, MAX_DESCRIPTION);
  if (!content || !proof.verificationPassed || proof.evidenceDigests.length === 0) return undefined;
  const observationDigest = digest(`${request.taskId}\0${content}\0${proof.evidenceDigests.join(",")}`);
  const timestamp = Date.parse(proof.timestamp);
  if (!Number.isFinite(timestamp)) return undefined;
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "pattern",
    confidence: "high",
    content,
    projectKey: projectKey(cwd),
    source: "pi-subagents:proof-verified",
    evidenceRefs: proof.evidenceDigests.map((evidenceDigest, index) => ({
      id: `task:${request.taskId}:evidence:${index}`,
      digest: evidenceDigest,
      trust: "verified-command",
      description: "Verified task evidence receipt",
    })),
    context: request.agentType,
    timestamp,
    digest: observationDigest,
    idempotencyKey: observationDigest,
  };
}
