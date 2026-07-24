export interface AislopDiagnostic {
  engine?: string;
  severity?: string;
  filePath?: string;
  line?: number;
  message?: string;
}

interface AislopData {
  score: number;
  summary: { errors: number; warnings: number };
  diagnostics: AislopDiagnostic[];
  engineDefinitions: Record<string, { label?: string }>;
}

export function formatAislopJson(raw: string): string {
  const data = parseAislopData(raw);
  return data ? formatAislopData(data) : "";
}

function parseAislopData(raw: string): AislopData | null {
  try {
    const parsed: unknown = raw.startsWith("{") ? JSON.parse(raw) : null;
    if (!isRecord(parsed) || parsed.scoreable !== true) return null;
    return {
      score: numberValue(parsed.score),
      summary: parseSummary(parsed.summary),
      diagnostics: parseDiagnostics(parsed.diagnostics),
      engineDefinitions: parseEngineDefinitions(parsed.engineDefinitions),
    };
  } catch {
    return null;
  }
}

function formatAislopData(data: AislopData): string {
  const color = data.score >= 80 ? "OK" : data.score >= 50 ? "WARN" : "FAIL";
  const lines = [`Slop score: ${data.score}/100 (${color})`, ...formatSummary(data.summary)];
  for (const [engine, diagnostics] of groupDiagnostics(data.diagnostics)) {
    lines.push(...formatEngine(engine, diagnostics, data.engineDefinitions));
  }
  return lines.length <= 1 ? "No slop issues found" : lines.join("\n");
}

function formatSummary(summary: AislopData["summary"]): string[] {
  const parts = [summary.errors ? `${summary.errors} errors` : "", summary.warnings ? `${summary.warnings} warnings` : ""].filter(Boolean);
  return parts.length ? [`Findings: ${parts.join(", ")}`] : [];
}

function groupDiagnostics(diagnostics: AislopDiagnostic[]): Map<string, AislopDiagnostic[]> {
  const groups = new Map<string, AislopDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    const engine = diagnostic.engine || "unknown";
    groups.set(engine, [...(groups.get(engine) ?? []), diagnostic]);
  }
  return groups;
}

function formatEngine(engine: string, diagnostics: AislopDiagnostic[], definitions: AislopData["engineDefinitions"]): string[] {
  const lines = [`  ${(definitions[engine]?.label || engine).padEnd(14)}  ${diagnostics.length} finding(s)`];
  for (const diagnostic of diagnostics.slice(0, 5)) lines.push(formatDiagnostic(diagnostic));
  if (diagnostics.length > 5) lines.push(`    ... and ${diagnostics.length - 5} more`);
  return lines;
}

function formatDiagnostic(diagnostic: AislopDiagnostic): string {
  const tag = diagnostic.severity === "error" ? "[ERR]" : diagnostic.severity === "warning" ? "[WARN]" : "[INFO]";
  const location = diagnostic.filePath ? ` (${diagnostic.filePath}${diagnostic.line ? `:${diagnostic.line}` : ""})` : "";
  return `    ${tag} ${(diagnostic.message || "").slice(0, 100)}${location}`;
}

function parseSummary(value: unknown): AislopData["summary"] {
  if (!isRecord(value)) return { errors: 0, warnings: 0 };
  return { errors: numberValue(value.errors), warnings: numberValue(value.warnings) };
}

function parseDiagnostics(value: unknown): AislopDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((diagnostic) => ({
    engine: stringValue(diagnostic.engine),
    severity: stringValue(diagnostic.severity),
    filePath: stringValue(diagnostic.filePath),
    line: typeof diagnostic.line === "number" ? diagnostic.line : undefined,
    message: stringValue(diagnostic.message),
  }));
}

function parseEngineDefinitions(value: unknown): AislopData["engineDefinitions"] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([name, value]) => {
    if (!isRecord(value)) return [];
    return [[name, { label: stringValue(value.label) }]];
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
