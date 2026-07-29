/**
 * Learning-coordinator protocol layer, now sourced from @minhduydev/pi-core.
 *
 * This file used to reimplement the context-request and proof parsers with
 * its own digest — the one copy of `taggedDigest` (of the audit's nine) that
 * had actually diverged, and a digest preimage that never matched what the
 * producer signed (§2.2). The parsers and the digest are pi-core's now; what
 * remains here is the coordinator's OWN job: turning a verified
 * request + proof pair into bounded learning observations.
 */
import {
  bindingDigestFor,
  parseContextRequest as coreParseContextRequest,
  parseContextRequestV2 as coreParseContextRequestV2,
  parseProofVerified,
  sha256Hex,
  taggedDigest,
  PI_EVENTS_V1,
  PI_EVENTS_V2,
  type ContextRequestPayloadV1,
  type ContextRequestPayloadV2,
  type ProofVerifiedPayloadV1,
  type SupportedLearningClaimV1,
} from "@minhduydev/pi-core";

export const PROTOCOL_VERSION = 1 as const;
export const LEARNING_OBSERVATION_EVENT = PI_EVENTS_V1.LEARNING_OBSERVATION;
export const SUBAGENT_CONTEXT_REQUEST_EVENT = PI_EVENTS_V1.SUBAGENT_CONTEXT_REQUEST;
export const SUBAGENT_CONTEXT_REQUEST_EVENT_V2 = PI_EVENTS_V2.SUBAGENT_CONTEXT_REQUEST;
export const SUBAGENT_PROOF_EVENT = PI_EVENTS_V1.SUBAGENT_PROOF_VERIFIED;
/** pi-learning announces the project binding for a served request here. */
export const CONTEXT_SERVED_EVENT = "pi-learning:v1:context-served";
export const DCP_TELEMETRY_EVENT = "dcp:telemetry";

export type ContextRequestV1 = ContextRequestPayloadV1;
export type ContextRequestV2 = ContextRequestPayloadV2;
export type ContextRequest = ContextRequestV1 | ContextRequestV2;
export type ProofVerifiedV1 = ProofVerifiedPayloadV1;

export function parseContextRequest(value: unknown): ContextRequest | undefined {
  return coreParseContextRequestV2(value) ?? coreParseContextRequest(value);
}
export const parseProof = parseProofVerified;

/** The project identity pi-learning binds a served request to. */
export interface ContextBindingV1 {
  projectId: string;
  trustEpoch: string;
  sessionGeneration: string;
}

/**
 * Parse and VERIFY a `pi-learning:v1:context-served` announcement: the
 * binding must digest-match the request it claims to bind. This event is how
 * the binding travels now — pi-learning no longer writes identity fields
 * into the producer's payload, so nothing here depends on listener order.
 */
export function parseContextServed(value: unknown): (ContextBindingV1 & {
  taskId: string;
  correlationId: string;
  requestDigest: string;
}) | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (input.version !== 1) return undefined;
  const taskId = boundedIdentifier(input.taskId, 128);
  const correlationId = boundedIdentifier(input.correlationId, 240);
  const requestDigest = typeof input.requestDigest === "string" ? input.requestDigest : undefined;
  const projectId = boundedIdentifier(input.projectId, 240);
  const trustEpoch = boundedIdentifier(input.trustEpoch, 240);
  const sessionGeneration = boundedIdentifier(input.sessionGeneration, 240);
  if (!taskId || !correlationId || !requestDigest || !projectId || !trustEpoch || !sessionGeneration) {
    return undefined;
  }
  if (!/^sha256:v1:[0-9a-f]{64}$/.test(requestDigest)) return undefined;
  const expected = bindingDigestFor({
    requestDigest: requestDigest as `sha256:v1:${string}`,
    projectId,
    trustEpoch,
    sessionGeneration,
  });
  if (input.bindingDigest !== expected) return undefined;
  return { taskId, correlationId, requestDigest, projectId, trustEpoch, sessionGeneration };
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

const SECRET_PATTERNS = [
  /-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gi,
  /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{12,}/gi,
  /\b(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|passwd|secret)\s*[:=]\s*[^\s,;]+/gi,
  /\b(?:gh[pousr]_|sk-|xox[baprs]-)[a-z0-9_-]{12,}/gi,
  /\bAKIA[A-Z0-9]{16}\b/gi,
  /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi,
  /\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|earlier)\s+instructions\b/gi,
];

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

function sameDigestSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    right.every((digestValue) => left.includes(digestValue))
  );
}

/** Convert a verified, project-bound request and proof into learning observations. */
export function createObservations(
  request: ContextRequest,
  proof: ProofVerifiedV1,
  binding: ContextBindingV1,
  _cwd: string,
): LearningObservationV1[] {
  if (
    !proof.verificationPassed ||
    proof.correlationId !== request.correlationId ||
    proof.requestDigest !== request.requestDigest
  ) return [];
  // A proof that DOES carry identity fields must agree with the binding.
  if (
    (proof.projectId !== undefined && proof.projectId !== binding.projectId) ||
    (proof.trustEpoch !== undefined && proof.trustEpoch !== binding.trustEpoch) ||
    (proof.sessionGeneration !== undefined && proof.sessionGeneration !== binding.sessionGeneration)
  ) return [];
  const timestamp = Date.parse(proof.timestamp);
  if (!Number.isFinite(timestamp)) return [];
  const supportByClaim = new Map<string, SupportedLearningClaimV1>();
  for (const support of proof.supportedClaims) {
    if (supportByClaim.has(support.claimId)) return [];
    supportByClaim.set(support.claimId, support);
  }
  const claims = request.protocolVersion === 2
    ? request.learningIntents.map((claim) => ({ claim, expectedDigests: undefined }))
    : request.learningClaims.map((claim) => ({
        claim,
        expectedDigests: claim.support.evidenceRefs.map((reference) => reference.digest),
      }));
  return claims.flatMap(({ claim, expectedDigests }) => {
    const support = supportByClaim.get(claim.claimId);
    const content = boundedIdentifier(claim.statement, 400);
    if (!support?.supported || !content || support.evidenceDigests.length === 0) return [];
    if (expectedDigests && !sameDigestSet(expectedDigests, support.evidenceDigests)) return [];
    const evidenceRefs = support.evidenceDigests.map((digest, index) => ({
      id: `task:${request.taskId}:claim:${claim.claimId}:evidence:${index}`,
      digest: digest.slice("sha256:v1:".length),
      trust: "verified-command" as const,
      description: "Claim-bound verified task evidence",
    }));
    return [{
      kind: claim.kind,
      content,
      projectKey: binding.projectId,
      source: "pi-subagents:proof-verified",
      evidenceRefs,
      context: claim.applicability,
      timestamp,
      idempotencyKey: sha256Hex(`${request.taskId}\0${claim.claimId}\0${request.requestDigest}`),
    }];
  });
}

export function createObservation(
  request: ContextRequest,
  proof: ProofVerifiedV1,
  binding: ContextBindingV1,
  cwd: string,
): LearningObservationV1 | undefined {
  return createObservations(request, proof, binding, cwd)[0];
}

export { taggedDigest };
