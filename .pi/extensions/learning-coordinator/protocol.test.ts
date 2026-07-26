import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createObservations, parseContextRequest, parseProof } from "./protocol.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonical(input[key])]));
}
const tagged = (value: unknown) => `sha256:v1:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
const evidenceDigest = `sha256:v1:${"a".repeat(64)}`;
const claimBody = (statement: string) => ({
  version: 1 as const,
  kind: "pattern" as const,
  statement,
  applicability: "bounded protocol tests",
  support: {
    mode: "task-outcome" as const,
    evidenceRefs: [{ kind: "evidence-receipt" as const, ref: "receipt-1", digest: evidenceDigest }],
  },
});
const claim = (statement: string) => {
  const body = claimBody(statement);
  return { ...body, claimId: tagged(body) };
};
function request(claims = [claim("Use bounded evidence")]) {
  const body = {
    taskId: "task-1",
    correlationId: "corr-1",
    projectId: "project-1",
    trustEpoch: "trust-1",
    sessionGeneration: "session-1",
    agentType: "general",
    description: "task description",
    learningClaims: claims,
  };
  return { protocolVersion: 1 as const, ...body, requestDigest: tagged(body) };
}
function proof(input: ReturnType<typeof request>, supportedClaims: unknown[]) {
  return {
    protocolVersion: 1,
    taskId: "canonical-task-1",
    correlationId: input.correlationId,
    requestDigest: input.requestDigest,
    projectId: input.projectId,
    trustEpoch: input.trustEpoch,
    sessionGeneration: input.sessionGeneration,
    supportedClaims,
    verificationPassed: true,
    verificationIssues: [],
    evidenceDigests: ["b".repeat(64)],
    timestamp: "2026-07-26T00:00:00.000Z",
  };
}

test("fails closed on claim identity and request digest mismatches", () => {
  const valid = request();
  assert.equal(parseContextRequest({ ...valid, requestDigest: `sha256:v1:${"f".repeat(64)}` }), undefined);
  assert.equal(parseContextRequest({ ...valid, learningClaims: [{ ...valid.learningClaims[0], statement: "mutated" }] }), undefined);
});

test("accepts only claim-specific support and fans out independently", () => {
  const claims = [claim("Use bounded evidence"), claim("Apply deterministic replay")];
  const parsedRequest = parseContextRequest(request(claims));
  assert.ok(parsedRequest);
  const parsedProof = parseProof(proof(request(claims), [
    { claimId: claims[0]!.claimId, supported: true, evidenceDigests: [evidenceDigest] },
    { claimId: claims[1]!.claimId, supported: false, evidenceDigests: [] },
  ]));
  assert.ok(parsedProof);
  assert.deepEqual(createObservations(parsedRequest, parsedProof, "/project").map((item) => item.content), ["Use bounded evidence"]);

  const wrongEvidence = parseProof(proof(request(claims), [
    { claimId: claims[0]!.claimId, supported: true, evidenceDigests: [`sha256:v1:${"c".repeat(64)}`] },
  ]));
  assert.ok(wrongEvidence);
  assert.deepEqual(createObservations(parsedRequest, wrongEvidence, "/project"), []);

  const wrongBinding = parseProof({
    ...proof(request(claims), [
      { claimId: claims[0]!.claimId, supported: true, evidenceDigests: [evidenceDigest] },
    ]),
    trustEpoch: "trust-other",
  });
  assert.ok(wrongBinding);
  assert.deepEqual(createObservations(parsedRequest, wrongBinding, "/project"), []);

  for (const field of ["projectId", "sessionGeneration"] as const) {
    const mismatch = parseProof({
      ...proof(request(claims), [
        { claimId: claims[0]!.claimId, supported: true, evidenceDigests: [evidenceDigest] },
      ]),
      [field]: `mismatch-${field}`,
    });
    assert.ok(mismatch);
    assert.deepEqual(createObservations(parsedRequest, mismatch, "/project"), []);
  }
});

test("rejects unknown wire fields rather than accepting ambiguous contracts", () => {
  assert.equal(parseContextRequest({ ...request(), candidateText: "description-derived" }), undefined);
});
