/**
 * Deterministic full-project quality-debt ratchet.
 *
 * A finding identity intentionally excludes source line/column: edits above an
 * accepted finding must not turn it into "new" debt. File, engine, rule,
 * severity, and message are stable enough to distinguish the debt itself.
 */

const BASELINE_VERSION = 1;

function boundedString(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024) {
    throw new Error(`Invalid aislop ${field}`);
  }
  return value;
}

export function findingFingerprint(diagnostic) {
  return [
    boundedString(diagnostic.filePath, "filePath"),
    boundedString(diagnostic.engine, "engine"),
    boundedString(diagnostic.rule, "rule"),
    boundedString(diagnostic.severity, "severity"),
    boundedString(diagnostic.message, "message"),
  ].join("\u001f");
}

export function buildQualityBaseline(report, capturedAt = new Date().toISOString()) {
  if (
    typeof report !== "object" ||
    report === null ||
    report.schemaVersion !== "1" ||
    typeof report.version !== "string" ||
    !Number.isInteger(report.score) ||
    !Array.isArray(report.diagnostics)
  ) {
    throw new Error("Unsupported aislop report");
  }

  const findings = {};
  const engines = {};
  for (const diagnostic of report.diagnostics) {
    const fingerprint = findingFingerprint(diagnostic);
    const existing = findings[fingerprint];
    if (existing) {
      existing.count += 1;
    } else {
      findings[fingerprint] = {
        count: 1,
        filePath: diagnostic.filePath,
        engine: diagnostic.engine,
        rule: diagnostic.rule,
        severity: diagnostic.severity,
        message: diagnostic.message,
      };
    }
    engines[diagnostic.engine] = (engines[diagnostic.engine] ?? 0) + 1;
  }

  return {
    version: BASELINE_VERSION,
    capturedAt,
    tool: {
      name: "aislop",
      version: report.version,
      reportSchemaVersion: report.schemaVersion,
      scope: "full-project",
    },
    minimumScore: report.score,
    minimumSupportedFiles: report.coverage?.supportedFiles ?? 0,
    totalFindings: report.diagnostics.length,
    engines: Object.fromEntries(Object.entries(engines).sort(([a], [b]) => a.localeCompare(b))),
    findings: Object.fromEntries(Object.entries(findings).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function validateBaseline(baseline, report) {
  if (
    typeof baseline !== "object" ||
    baseline === null ||
    baseline.version !== BASELINE_VERSION ||
    typeof baseline.tool !== "object" ||
    baseline.tool === null ||
    baseline.tool.name !== "aislop" ||
    baseline.tool.scope !== "full-project" ||
    baseline.tool.version !== report.version ||
    baseline.tool.reportSchemaVersion !== report.schemaVersion ||
    !Number.isInteger(baseline.minimumScore) ||
    !Number.isInteger(baseline.minimumSupportedFiles) ||
    !Number.isInteger(baseline.totalFindings) ||
    typeof baseline.engines !== "object" ||
    baseline.engines === null ||
    typeof baseline.findings !== "object" ||
    baseline.findings === null
  ) {
    throw new Error("Invalid or incompatible quality-debt baseline");
  }
}

export function compareQualityReport(report, baseline) {
  validateBaseline(baseline, report);
  const current = buildQualityBaseline(report, baseline.capturedAt);
  const regressions = [];
  const improvements = [];

  if (current.minimumScore < baseline.minimumScore) {
    regressions.push(
      `score regressed: ${current.minimumScore} < baseline ${baseline.minimumScore}`,
    );
  } else if (current.minimumScore > baseline.minimumScore) {
    improvements.push(
      `score improved: ${baseline.minimumScore} -> ${current.minimumScore}`,
    );
  }

  if (current.minimumSupportedFiles < baseline.minimumSupportedFiles) {
    regressions.push(
      `supported source coverage regressed: ${current.minimumSupportedFiles} < ` +
        `baseline ${baseline.minimumSupportedFiles}`,
    );
  }

  if (current.totalFindings > baseline.totalFindings) {
    regressions.push(
      `total findings increased: ${current.totalFindings} > baseline ${baseline.totalFindings}`,
    );
  } else if (current.totalFindings < baseline.totalFindings) {
    improvements.push(
      `total findings decreased: ${baseline.totalFindings} -> ${current.totalFindings}`,
    );
  }

  const engineNames = new Set([
    ...Object.keys(baseline.engines),
    ...Object.keys(current.engines),
  ]);
  for (const engine of [...engineNames].sort()) {
    const allowed = baseline.engines[engine] ?? 0;
    const actual = current.engines[engine] ?? 0;
    if (actual > allowed) {
      regressions.push(`engine ${engine} findings increased: ${actual} > ${allowed}`);
    } else if (actual < allowed) {
      improvements.push(`engine ${engine} findings decreased: ${allowed} -> ${actual}`);
    }
  }

  const fingerprints = new Set([
    ...Object.keys(baseline.findings),
    ...Object.keys(current.findings),
  ]);
  for (const fingerprint of [...fingerprints].sort()) {
    const allowed = baseline.findings[fingerprint]?.count ?? 0;
    const actual = current.findings[fingerprint]?.count ?? 0;
    if (actual > allowed) {
      const finding = current.findings[fingerprint];
      regressions.push(
        `new/increased finding (${actual} > ${allowed}): ${finding.filePath} :: ` +
          `${finding.engine}/${finding.rule} :: ${finding.message}`,
      );
    } else if (actual < allowed) {
      const finding = baseline.findings[fingerprint];
      improvements.push(
        `finding reduced (${allowed} -> ${actual}): ${finding.filePath} :: ` +
          `${finding.engine}/${finding.rule}`,
      );
    }
  }

  return {
    passed: regressions.length === 0 && improvements.length === 0,
    regressions,
    improvements,
    baselineUpdateRequired: regressions.length === 0 && improvements.length > 0,
    current,
  };
}
