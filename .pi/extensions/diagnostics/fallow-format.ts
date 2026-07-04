export function formatFallowHealth(raw: string): string {
  try {
    const data = JSON.parse(raw);
    const summary = summarizeFallowJson(data);
    const lines: string[] = [];
    if (summary) lines.push(summary);

    const largeFns = data.largeFunctions || [];
    if (largeFns.length > 0) {
      lines.push(`${largeFns.length} large function(s):`);
      for (const fn of largeFns.slice(0, 10)) {
        const loc = `${fn.file || "?"}:${fn.line || "?"}`;
        lines.push(`  - ${fn.name || "anonymous"} (${loc}) — ${fn.lines || "?"} lines`);
      }
      if (largeFns.length > 10) lines.push(`  ... and ${largeFns.length - 10} more`);
    }

    const complex = data.highComplexityFunctions || [];
    if (complex.length > 0) {
      lines.push(`${complex.length} high-complexity function(s):`);
      for (const fn of complex.slice(0, 10)) {
        const loc = `${fn.file || "?"}:${fn.line || "?"}`;
        lines.push(`  - ${fn.name || "anonymous"} (${loc}) — ${fn.severity || ""}`.trim());
      }
      if (complex.length > 10) lines.push(`  ... and ${complex.length - 10} more`);
    }

    const files = data.fileHealthScores || [];
    if (files.length > 0) {
      const worst = [...files].sort((a, b) => (a.score || 0) - (b.score || 0)).slice(0, 5);
      lines.push(`Health scores (worst 5 of ${files.length} files):`);
      for (const f of worst) {
        const pct = f.deadPercentage !== undefined ? `, ${f.deadPercentage}% dead` : "";
        lines.push(`  ${f.score?.toFixed(1) || "?"}  ${f.file || "?"} (${f.loc || "?"} LOC${pct})`);
      }
    }

    const refactors = data.refactoringTargets || [];
    if (refactors.length > 0) {
      lines.push(`${refactors.length} refactoring target(s):`);
      for (const r of refactors.slice(0, 5)) {
        const reason = r.reason || r.issue || "";
        const effort = r.effort ? ` [effort: ${r.effort}]` : "";
        lines.push(`  priority ${r.priority || "?"}  ${r.file || "?"}${effort}${reason ? ` — ${reason}` : ""}`);
      }
    }

    if (lines.length === 0) return "No quality issues found";
    return lines.join("\n");
  } catch {
    const truncated = raw.split("\n").slice(0, 15).join("\n");
    return truncated || "";
  }
}

export function formatFallowDeadCode(raw: string): string {
  try {
    const data = JSON.parse(raw);
    const summary = summarizeFallowJson(data);
    const lines: string[] = [];
    if (summary) lines.push(summary);

    const unusedFiles = data.unusedFiles || [];
    if (unusedFiles.length > 0) {
      lines.push(`${unusedFiles.length} unused file(s):`);
      for (const f of unusedFiles.slice(0, 10)) {
        lines.push(`  - ${f.file || f.path || f}`);
      }
      if (unusedFiles.length > 10) lines.push(`  ... and ${unusedFiles.length - 10} more`);
    }

    const unusedExports = data.unusedExports || data.unusedExportsAndTypes || [];
    if (unusedExports.length > 0) {
      lines.push(`${unusedExports.length} unused export(s):`);
      for (const e of unusedExports.slice(0, 10)) {
        lines.push(`  - ${e.exportName || e.name || e.symbol || "?"} in ${e.file || "?"}`);
      }
      if (unusedExports.length > 10) lines.push(`  ... and ${unusedExports.length - 10} more`);
    }

    const circular = data.circularDependencies || [];
    if (circular.length > 0) {
      lines.push(`${circular.length} circular dependenc(y|ies):`);
      for (const c of circular.slice(0, 5)) {
        const chain = Array.isArray(c) ? c.join(" → ") : (c.chain || c.files?.join(" → ") || String(c));
        lines.push(`  ${chain}`);
      }
    }

    if (lines.length === 0) return "No dead code found";
    return lines.join("\n");
  } catch {
    return "";
  }
}

export function formatFallowCheckChanged(raw: string): string {
  try {
    const data = JSON.parse(raw);
    const summary = summarizeFallowJson(data);
    const lines: string[] = [];
    if (summary) lines.push(summary);

    for (const section of ["check", "dead_code", "dupes", "health"] as const) {
      const nested = data[section];
      if (nested && typeof nested === "object") {
        const nestedSummary = summarizeFallowJson(nested as Record<string, unknown>);
        if (nestedSummary) lines.push(`${section}: ${nestedSummary}`);
      }
    }

    if (lines.length === 0) return "No changed-file issues found";
    return lines.join("\n");
  } catch {
    return raw.split("\n").slice(0, 20).join("\n");
  }
}

export function summarizeFallowJson(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const obj = data as Record<string, unknown>;
  const parts: string[] = [];
  if (obj.verdict != null) parts.push(`verdict=${obj.verdict}`);
  if (typeof obj.total_issues === "number") parts.push(`total_issues=${obj.total_issues}`);
  if (Array.isArray(obj.findings)) parts.push(`findings=${obj.findings.length}`);
  return parts.join(", ");
}