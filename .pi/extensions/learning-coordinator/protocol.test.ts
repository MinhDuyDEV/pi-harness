import assert from "node:assert/strict";
import test from "node:test";
import {
  makeContextRequestPayload,
  makeLearningClaim,
  makeProofVerifiedPayload,
  taggedDigest,
} from "@minhduydev/pi-core";
import {
  createObservations,
  parseContextRequest,
  parseContextServed,
  parseProof,
  type ContextBindingV1,
} from "./protocol.js";
import { bindingDigestFor } from "@minhduydev/pi-core";

// Payloads are built with pi-core's REAL constructors. This file used to
// reimplement the digest and hand-roll fixtures — which is how the harness's
// parser passed its tests while rejecting every payload the actual producer
// emitted (§2.2): each side was tested against its own invention.
const evidenceDigest = taggedDigest({ evidence: "protocol-test" });
const claim = (statement: string) =>
  makeLearningClaim({
    version: 1,
    kind: "pattern",
    statement,
    applicability: "bounded protocol tests",
    support: {
      mode: "task-outcome",
      evidenceRefs: [{ kind: "evidence-receipt", ref: "receipt-1", digest: evidenceDigest }],
    },
  });

const binding: ContextBindingV1 = {
  projectId: "project-1",
  trustEpoch: "trust-1",
  sessionGeneration: "session-1",
};

function request(claims = [claim("Use bounded evidence")]) {
  return makeContextRequestPayload(
    "task-1",
    "general",
    "task description",
    "corr-1",
    claims,
  );
}

function proof(
  input: ReturnType<typeof request>,
  supportedClaims: unknown[],
  bindingFields: Partial<ContextBindingV1> = binding,
) {
  return makeProofVerifiedPayload({
    taskId: "canonical-task-1",
    verificationPassed: true,
    issues: [],
    evidenceDigests: ["b".repeat(64)],
    correlationId: input.correlationId,
    requestDigest: input.requestDigest,
    ...bindingFields,
    supportedClaims,
    timestamp: "2026-07-26T00:00:00.000Z",
  });
}

test("fails closed on claim identity and request digest mismatches", () => {
  const valid = request();
  assert.equal(parseContextRequest({ ...valid, requestDigest: `sha256:v1:${"f".repeat(64)}` }), undefined);
  assert.equal(
    parseContextRequest({
      ...valid,
      description: "task description, altered after signing",
    }),
    undefined,
  );
});

test("the producer's raw payload parses — no coordinator injection required", () => {
  // §2.3: on the published dists this was false for every payload.
  const parsed = parseContextRequest(request());
  assert.ok(parsed);
  assert.equal(parsed.confidence, "high");
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
  assert.deepEqual(
    createObservations(parsedRequest, parsedProof, binding, "/project").map((item) => item.content),
    ["Use bounded evidence"],
  );

  const wrongEvidence = parseProof(proof(request(claims), [
    { claimId: claims[0]!.claimId, supported: true, evidenceDigests: [taggedDigest({ other: 1 })] },
  ]));
  assert.ok(wrongEvidence);
  assert.deepEqual(createObservations(parsedRequest, wrongEvidence, binding, "/project"), []);
});

test("a proof carrying identity fields must agree with the verified binding", () => {
  const claims = [claim("Use bounded evidence")];
  const parsedRequest = parseContextRequest(request(claims));
  assert.ok(parsedRequest);
  const support = [
    { claimId: claims[0]!.claimId, supported: true, evidenceDigests: [evidenceDigest] },
  ];

  for (const field of ["projectId", "trustEpoch", "sessionGeneration"] as const) {
    const mismatch = parseProof(
      proof(request(claims), support, { ...binding, [field]: `mismatch-${field}` }),
    );
    assert.ok(mismatch);
    assert.deepEqual(createObservations(parsedRequest, mismatch, binding, "/project"), []);
  }

  // A proof with NO identity fields is fine — the binding is authoritative.
  const bare = parseProof(proof(request(claims), support, {}));
  assert.ok(bare);
  assert.equal(createObservations(parsedRequest, bare, binding, "/project").length, 1);
});

test("additive unknown fields are tolerated, not treated as contract violations", () => {
  // The old exact-key allowlist turned every additive producer field into a
  // breaking change for consumers that had not upgraded (roadmap §Đợt 3).
  const parsed = parseContextRequest({ ...request(), futureField: "additive" });
  assert.ok(parsed);
});

test("context-served announcements verify their binding digest", () => {
  const base = request();
  const served = {
    version: 1,
    taskId: base.taskId,
    correlationId: base.correlationId,
    requestDigest: base.requestDigest,
    ...binding,
    bindingDigest: bindingDigestFor({ requestDigest: base.requestDigest, ...binding }),
  };
  assert.ok(parseContextServed(served));
  assert.equal(parseContextServed({ ...served, trustEpoch: "trust-FORGED" }), undefined);
  assert.equal(parseContextServed({ ...served, bindingDigest: taggedDigest({ x: 1 }) }), undefined);
  assert.equal(parseContextServed({ version: 2 }), undefined);
});
