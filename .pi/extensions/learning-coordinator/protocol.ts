import { createHash } from "node:crypto";

export const PROTOCOL_VERSION = 1 as const;
export const LEARNING_OBSERVATION_EVENT = "pi-learning:observation:v1";
export const SUBAGENT_CONTEXT_REQUEST_EVENT = "pi-subagents:v1:context-request";
export const SUBAGENT_PROOF_EVENT = "pi-subagents:v1:proof-verified";
export const DCP_TELEMETRY_EVENT = "dcp:telemetry";

const SHA256 = /^[a-f0-9]{64}$/i;
const TAGGED_SHA256 = /^sha256:v1:[a-f0-9]{64}$/;
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

export interface LearningEvidenceRefV1 {
  kind: "repository-file" | "evidence-receipt";
  ref: string;
  digest: string;
}

export interface LearningClaimV1 {
  version: 1;
  claimId: string;
  kind: "pattern" | "discovery";
  statement: string;
  applicability: string;
  support: {
    mode: "direct-artifact" | "task-outcome";
    evidenceRefs: readonly LearningEvidenceRefV1[];
  };
}

export interface SupportedLearningClaimV1 {
  claimId: string;
  supported: boolean;
  evidenceDigests: readonly string[];
}

export interface ContextRequestV1 {
  protocolVersion: 1;
  taskId: string;
  correlationId: string;
  requestDigest: string;
  projectId?: string;
  trustEpoch?: string;
  sessionGeneration?: string;
  agentType: string;
  description: string;
  confidence?: "high" | "medium" | "low";
  learningClaims: readonly LearningClaimV1[];
  response?: unknown;
}

export interface ProofVerifiedV1 {
  protocolVersion: 1;
  taskId: string;
  correlationId: string;
  requestDigest: string;
  projectId: string;
  trustEpoch: string;
  sessionGeneration: string;
  supportedClaims: readonly SupportedLearningClaimV1[];
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

function hasOnlyKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(input).every((key) => keys.has(key));
}

function taggedDigest(value: unknown): string {
  return `sha256:v1:${digest(canonical(value))}`;
}

function parseLearningEvidenceRef(value: unknown): LearningEvidenceRefV1 | undefined {
  const input = record(value);
  if (
    !input ||
    !hasOnlyKeys(input, ["kind", "ref", "digest"]) ||
    (input.kind !== "repository-file" && input.kind !== "evidence-receipt") ||
    !TAGGED_SHA256.test(String(input.digest))
  ) return undefined;
  const ref = boundedIdentifier(input.ref, 240);
  return ref ? { kind: input.kind, ref, digest: String(input.digest) } : undefined;
}

function parseLearningClaim(value: unknown): LearningClaimV1 | undefined {
  const input = record(value);
  if (
    !input ||
    !hasOnlyKeys(input, ["version", "claimId", "kind", "statement", "applicability", "support"]) ||
    input.version !== 1 ||
    (input.kind !== "pattern" && input.kind !== "discovery") ||
    !TAGGED_SHA256.test(String(input.claimId))
  ) return undefined;
  const statement = boundedIdentifier(input.statement, 400);
  const applicability = boundedIdentifier(input.applicability, 240);
  const support = record(input.support);
  if (
    !statement ||
    !applicability ||
    !support ||
    !hasOnlyKeys(support, ["mode", "evidenceRefs"]) ||
    (support.mode !== "direct-artifact" && support.mode !== "task-outcome") ||
    !Array.isArray(support.evidenceRefs) ||
    support.evidenceRefs.length === 0 ||
    support.evidenceRefs.length > 16
  ) return undefined;
  const evidenceRefs = support.evidenceRefs.map(parseLearningEvidenceRef);
  if (evidenceRefs.some((item) => !item)) return undefined;
  const body: Omit<LearningClaimV1, "claimId"> = {
    version: 1,
    kind: input.kind as LearningClaimV1["kind"],
    statement,
    applicability,
    support: {
      mode: support.mode as LearningClaimV1["support"]["mode"],
      evidenceRefs: evidenceRefs as LearningEvidenceRefV1[],
    },
  };
  if (taggedDigest(body) !== input.claimId) return undefined;
  return { ...body, claimId: String(input.claimId) };
}

function parseSupportedClaim(value: unknown): SupportedLearningClaimV1 | undefined {
  const input = record(value);
  if (
    !input ||
    !hasOnlyKeys(input, ["claimId", "supported", "evidenceDigests"]) ||
    !TAGGED_SHA256.test(String(input.claimId)) ||
    typeof input.supported !== "boolean" ||
    !Array.isArray(input.evidenceDigests) ||
    input.evidenceDigests.length > 16 ||
    !input.evidenceDigests.every((item) => typeof item === "string" && TAGGED_SHA256.test(item))
  ) return undefined;
  return {
    claimId: String(input.claimId),
    supported: input.supported,
    evidenceDigests: [...input.evidenceDigests] as string[],
  };
}

export function parseContextRequest(value: unknown): ContextRequestV1 | undefined {
  const input = record(value);
  if (
    !input ||
    !hasOnlyKeys(input, ["protocolVersion", "taskId", "correlationId", "requestDigest", "projectId", "trustEpoch", "sessionGeneration", "agentType", "description", "confidence", "learningClaims", "response"]) ||
    input.protocolVersion !== PROTOCOL_VERSION ||
    !TAGGED_SHA256.test(String(input.requestDigest)) ||
    !Array.isArray(input.learningClaims) ||
    input.learningClaims.length > 16
  ) return undefined;
  const taskId = boundedIdentifier(input.taskId, 128);
  const correlationId = boundedIdentifier(input.correlationId, 128) ?? taskId;
  const projectId = input.projectId === undefined ? undefined : boundedIdentifier(input.projectId, 160);
  const trustEpoch = input.trustEpoch === undefined ? undefined : boundedIdentifier(input.trustEpoch, 160);
  const sessionGeneration = input.sessionGeneration === undefined ? undefined : boundedIdentifier(input.sessionGeneration, 160);
  const agentType = boundedIdentifier(input.agentType, 64);
  const description = input.description === "" ? "" : sanitizeText(input.description, MAX_DESCRIPTION);
  const learningClaims = input.learningClaims.map(parseLearningClaim);
  if (!taskId || !correlationId || !agentType || description === undefined || learningClaims.some((claim) => !claim)) return undefined;
  const claims = learningClaims as LearningClaimV1[];
  const expectedDigest = taggedDigest({ taskId, agentType, description, correlationId, ...(projectId ? { projectId } : {}), ...(trustEpoch ? { trustEpoch } : {}), ...(sessionGeneration ? { sessionGeneration } : {}), learningClaims: claims });
  if (expectedDigest !== input.requestDigest) return undefined;
  return {
    protocolVersion: PROTOCOL_VERSION,
    taskId,
    correlationId,
    requestDigest: String(input.requestDigest),
    ...(projectId ? { projectId } : {}),
    ...(trustEpoch ? { trustEpoch } : {}),
    ...(sessionGeneration ? { sessionGeneration } : {}),
    agentType,
    description,
    learningClaims: claims,
    ...(input.confidence === "high" || input.confidence === "medium" || input.confidence === "low"
      ? { confidence: input.confidence }
      : {}),
    ...(input.response === undefined ? {} : { response: input.response }),
  };
}

export function parseProof(value: unknown): ProofVerifiedV1 | undefined {
  const input = record(value);
  if (
    !input ||
    !hasOnlyKeys(input, ["protocolVersion", "taskId", "correlationId", "requestDigest", "projectId", "trustEpoch", "sessionGeneration", "supportedClaims", "verificationPassed", "verificationIssues", "evidenceDigests", "timestamp"]) ||
    input.protocolVersion !== PROTOCOL_VERSION ||
    typeof input.verificationPassed !== "boolean" ||
    !TAGGED_SHA256.test(String(input.requestDigest)) ||
    !Array.isArray(input.supportedClaims)
  ) return undefined;
  const taskId = boundedIdentifier(input.taskId, 128);
  const correlationId = boundedIdentifier(input.correlationId, 128) ?? taskId;
  const projectId = boundedIdentifier(input.projectId, 160);
  const trustEpoch = boundedIdentifier(input.trustEpoch, 160);
  const sessionGeneration = boundedIdentifier(input.sessionGeneration, 160);
  const timestamp = boundedIdentifier(input.timestamp, MAX_TIMESTAMP);
  if (!taskId || !correlationId || !projectId || !trustEpoch || !sessionGeneration || !timestamp || !Number.isFinite(Date.parse(timestamp)) || !Array.isArray(input.evidenceDigests) || !Array.isArray(input.verificationIssues)) return undefined;
  if (input.evidenceDigests.some((item) => typeof item !== "string" || !SHA256.test(item))) return undefined;
  const supportedClaims = input.supportedClaims.map(parseSupportedClaim);
  if (supportedClaims.some((claim) => !claim)) return undefined;
  const evidenceDigests = input.evidenceDigests.slice(0, 20).map((item) => (item as string).toLowerCase());
  const verificationIssues = input.verificationIssues
    .map((item) => sanitizeText(item, 300))
    .filter((item): item is string => item !== undefined)
    .slice(0, 10);
  return {
    protocolVersion: PROTOCOL_VERSION,
    taskId,
    correlationId,
    requestDigest: String(input.requestDigest),
    projectId,
    trustEpoch,
    sessionGeneration,
    supportedClaims: supportedClaims as SupportedLearningClaimV1[],
    verificationPassed: input.verificationPassed,
    verificationIssues,
    evidenceDigests,
    timestamp,
  };
}

function sameDigestSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && right.every((digestValue) => left.includes(digestValue));
}

export function createObservations(
  request: ContextRequestV1,
  proof: ProofVerifiedV1,
  _cwd: string,
): LearningObservationV1[] {
  if (
    !proof.verificationPassed ||
    !request.projectId ||
    !request.trustEpoch ||
    !request.sessionGeneration ||
    !proof.projectId ||
    !proof.trustEpoch ||
    !proof.sessionGeneration ||
    proof.correlationId !== request.correlationId ||
    proof.requestDigest !== request.requestDigest ||
    proof.projectId !== request.projectId ||
    proof.trustEpoch !== request.trustEpoch ||
    proof.sessionGeneration !== request.sessionGeneration
  ) return [];
  const timestamp = Date.parse(proof.timestamp);
  if (!Number.isFinite(timestamp)) return [];
  const projectKeyValue = request.projectId;
  if (!projectKeyValue) return [];
  const supportByClaim = new Map<string, SupportedLearningClaimV1>();
  for (const support of proof.supportedClaims) {
    if (supportByClaim.has(support.claimId)) return [];
    supportByClaim.set(support.claimId, support);
  }
  return request.learningClaims.flatMap((claim) => {
    const support = supportByClaim.get(claim.claimId);
    const expectedDigests = claim.support.evidenceRefs.map((reference) => reference.digest);
    const content = boundedIdentifier(claim.statement, 400);
    if (!support?.supported || !content || !sameDigestSet(expectedDigests, support.evidenceDigests)) return [];
    const evidenceRefs = claim.support.evidenceRefs.map((reference, index) => ({
      id: `task:${request.taskId}:claim:${claim.claimId}:evidence:${index}`,
      digest: reference.digest.slice("sha256:v1:".length),
      trust: "verified-command" as const,
      description: "Claim-bound verified task evidence",
    }));
    return [{
      kind: claim.kind,
      content,
      projectKey: projectKeyValue,
      source: "pi-subagents:proof-verified",
      evidenceRefs,
      context: claim.applicability,
      timestamp,
      idempotencyKey: digest(`${request.taskId}\0${claim.claimId}\0${request.requestDigest}`),
    }];
  });
}

export function createObservation(
  request: ContextRequestV1,
  proof: ProofVerifiedV1,
  cwd: string,
): LearningObservationV1 | undefined {
  return createObservations(request, proof, cwd)[0];
}
