export interface QualityDiagnostic {
  filePath: string;
  engine: string;
  rule: string;
  severity: string;
  message: string;
  line?: number;
  column?: number;
}

export interface QualityReport {
  schemaVersion: string;
  version: string;
  score: number;
  coverage?: { supportedFiles?: number };
  diagnostics: QualityDiagnostic[];
}

export interface QualityFinding extends QualityDiagnostic {
  count: number;
}

export interface QualityBaseline {
  version: number;
  capturedAt: string;
  tool: {
    name: "aislop";
    version: string;
    reportSchemaVersion: string;
    scope: "full-project";
  };
  minimumScore: number;
  minimumSupportedFiles: number;
  totalFindings: number;
  engines: Record<string, number>;
  findings: Record<string, QualityFinding>;
}

export function findingFingerprint(diagnostic: QualityDiagnostic): string;
export function buildQualityBaseline(report: QualityReport, capturedAt?: string): QualityBaseline;
export function compareQualityReport(
  report: QualityReport,
  baseline: QualityBaseline,
): {
  passed: boolean;
  regressions: string[];
  improvements: string[];
  baselineUpdateRequired: boolean;
  current: QualityBaseline;
};
