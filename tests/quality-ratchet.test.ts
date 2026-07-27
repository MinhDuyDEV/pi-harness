import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildQualityBaseline,
  compareQualityReport,
  findingFingerprint,
  type QualityDiagnostic,
} from "../scripts/lib/quality-ratchet.mjs";

function report(diagnostics: QualityDiagnostic[], score = 90) {
  return {
    schemaVersion: "1",
    version: "0.13.1",
    score,
    coverage: { supportedFiles: 10 },
    diagnostics,
  };
}

const accepted = {
  filePath: "src/legacy.ts",
  engine: "ai-slop",
  rule: "ai-slop/meta-comment",
  severity: "warning",
  message: "Legacy narrative comment",
  line: 10,
  column: 1,
};

test("fingerprint is stable across source movement", () => {
  assert.equal(
    findingFingerprint(accepted),
    findingFingerprint({ ...accepted, line: 999, column: 20 }),
  );
});

test("an identical full-project report passes the ratchet", () => {
  const current = report([accepted]);
  const baseline = buildQualityBaseline(current, "2026-07-27T00:00:00.000Z");
  assert.deepEqual(compareQualityReport(current, baseline), {
    passed: true,
    regressions: [],
    improvements: [],
    baselineUpdateRequired: false,
    current: baseline,
  });
});

test("new debt and increased duplicate counts fail closed", () => {
  const baseline = buildQualityBaseline(report([accepted]));
  const result = compareQualityReport(report([accepted, accepted]), baseline);
  assert.equal(result.passed, false);
  assert.ok(result.regressions.some((message) => message.includes("total findings increased")));
  assert.ok(result.regressions.some((message) => message.includes("new/increased finding")));
});

test("a lower score fails even when finding identities are unchanged", () => {
  const baseline = buildQualityBaseline(report([accepted], 90));
  const result = compareQualityReport(report([accepted], 89), baseline);
  assert.ok(result.regressions.some((message) => message.includes("score regressed")));
});

test("a reduced supported-source scope fails closed", () => {
  const baseline = buildQualityBaseline(report([accepted], 90));
  const reduced = report([accepted], 90);
  reduced.coverage.supportedFiles = 9;
  const result = compareQualityReport(reduced, baseline);
  assert.ok(result.regressions.some((message) => message.includes("supported source coverage")));
});

test("debt reduction requires updating the baseline so it cannot return later", () => {
  const baseline = buildQualityBaseline(report([accepted], 90));
  const result = compareQualityReport(report([], 100), baseline);
  assert.equal(result.passed, false);
  assert.equal(result.baselineUpdateRequired, true);
  assert.equal(result.regressions.length, 0);
  assert.ok(result.improvements.length > 0);
});

test("the aggregate quality gate includes a full-project pinned baseline", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const baseline = JSON.parse(
    readFileSync(
      new URL("../quality/aislop-debt-baseline.json", import.meta.url),
      "utf8",
    ),
  );
  assert.match(manifest.scripts.quality, /quality:ratchet/);
  assert.equal(manifest.scripts["quality:ratchet"], "node scripts/quality-ratchet.mjs");
  assert.doesNotMatch(manifest.scripts["quality:ratchet"], /--changes/);
  assert.equal(baseline.tool.version, manifest.devDependencies.aislop);
  assert.equal(baseline.tool.scope, "full-project");
  assert.ok(baseline.minimumSupportedFiles > 0);
});
