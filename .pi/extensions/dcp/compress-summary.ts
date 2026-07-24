import { getState } from "./compress-state.js";
import type {
  PersistentSessionSummary,
  ProbeEvaluationResult,
  ProbeResult,
  StructuredSummaryFields,
} from "./compress-types.js";
import type { DCPConfig, ProbeConfig } from "./config.js";

// Summary merging and probe evaluation

function parseCSV(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function mergeIntoPersistentSummary(
  sessionId: string,
  fields: StructuredSummaryFields,
  topic: string,
  blockId: number,
): PersistentSessionSummary {
  const ps = getState(sessionId).persistentSummary;

  const newReads = fields.files_read.filter((f) => !ps.files_read.includes(f));
  const newModifies = fields.files_modified.filter(
    (f) => !ps.files_modified.includes(f),
  );
  if (newReads.length > 0) ps.files_read = [...newReads, ...ps.files_read];
  if (newModifies.length > 0)
    ps.files_modified = [...newModifies, ...ps.files_modified];

  const existingDecisionTexts = new Set(ps.decisions.map((d) => d.text));
  for (const d of fields.decisions) {
    if (!existingDecisionTexts.has(d)) {
      ps.decisions.push({ text: d, block_id: blockId, timestamp: Date.now() });
      existingDecisionTexts.add(d);
    }
  }

  for (const ns of fields.next_steps) {
    ps.next_steps.push({ text: ns, block_id: blockId, timestamp: Date.now() });
  }
  if (ps.next_steps.length > 20) {
    ps.next_steps = ps.next_steps.slice(-20);
  }

  ps.topic = topic;
  ps.merged_block_ids.push(blockId);
  ps.last_updated = Date.now();

  return ps;
}

export function evaluateCompressionProbes(
  fields: StructuredSummaryFields,
  narrative: string,
  summaryTokens: number,
  config: ProbeConfig,
): ProbeEvaluationResult {
  const probes: ProbeResult[] = [];

  const hasReads = fields.files_read.length > 0;
  const hasModifies = fields.files_modified.length > 0;
  let fileCoverageScore: number;
  if (hasReads && hasModifies) {
    fileCoverageScore = 100;
  } else if (hasReads || hasModifies) {
    fileCoverageScore = 50;
  } else {
    fileCoverageScore = 0;
  }
  probes.push({
    name: "file-coverage",
    pass: fileCoverageScore >= config.minFileCoverage,
    score: fileCoverageScore,
    detail:
      hasReads && hasModifies
        ? `${fields.files_read.length} read, ${fields.files_modified.length} modified`
        : hasReads
          ? `${fields.files_read.length} read, no modified files`
          : hasModifies
            ? `no read files, ${fields.files_modified.length} modified`
            : "no file paths provided",
  });

  const decisionCount = fields.decisions.length;
  let decisionScore: number;
  if (decisionCount >= 3) {
    decisionScore = 100;
  } else if (decisionCount >= 1) {
    decisionScore = 50;
  } else {
    decisionScore = 0;
  }
  probes.push({
    name: "decision-coverage",
    pass: decisionScore >= config.minDecisionCoverage,
    score: decisionScore,
    detail:
      decisionCount >= 1
        ? `${decisionCount} decision${decisionCount !== 1 ? "s" : ""} captured`
        : "no decisions recorded",
  });

  const narrativeLen = narrative.length;
  let narrativeScore: number;
  if (narrativeLen > 500) {
    narrativeScore = 100;
  } else if (narrativeLen > 200) {
    narrativeScore = 60;
  } else if (narrativeLen > 50) {
    narrativeScore = 30;
  } else {
    narrativeScore = 0;
  }
  probes.push({
    name: "narrative-depth",
    pass: narrativeScore >= config.minNarrativeDepth,
    score: narrativeScore,
    detail: narrativeLen > 0 ? `${narrativeLen} characters` : "empty narrative",
  });

  const filledFields = [
    fields.files_read.length > 0,
    fields.files_modified.length > 0,
    fields.decisions.length > 0,
    fields.next_steps.length > 0,
  ];
  const filledCount = filledFields.filter(Boolean).length;
  const structScore = Math.round((filledCount / 4) * 100);
  probes.push({
    name: "structure-completeness",
    pass: structScore >= config.minStructureCompleteness,
    score: structScore,
    detail: `${filledCount}/4 structured fields populated`,
  });

  const overallScore = Math.round(
    probes.reduce((sum, p) => sum + p.score, 0) / probes.length,
  );
  const allPassed = probes.every((p) => p.pass);

  return {
    probes,
    overallScore,
    allPassed,
    summaryTokens,
    fieldsCount: filledCount,
  };
}

export function recordProbeResults(
  sessionId: string,
  result: ProbeEvaluationResult,
): void {
  const state = getState(sessionId);
  state.qualityMetrics.lastProbeResults = result;
  if (!result.allPassed) {
    state.qualityMetrics.failedProbes++;
  }
  const n = state.qualityMetrics.totalCompressions;
  if (n > 0) {
    const prevAvg = state.qualityMetrics.avgProbeScore;
    state.qualityMetrics.avgProbeScore =
      (prevAvg * (n - 1) + result.overallScore) / n;
  } else {
    state.qualityMetrics.avgProbeScore = result.overallScore;
  }
}

export function buildCompressedSummaryMessage(
  summary: PersistentSessionSummary,
): string {
  const parts: string[] = [];

  const mergedLabel =
    summary.merged_block_ids.length === 1
      ? `b${summary.merged_block_ids[0]}`
      : `b${summary.merged_block_ids[0]}\u2013b${summary.merged_block_ids[summary.merged_block_ids.length - 1]}`;
  parts.push(`\uF07C Session Context (${mergedLabel})`);

  if (summary.topic && summary.topic !== "session") {
    parts.push(`  Topic: ${summary.topic}`);
  }

  if (summary.files_read.length > 0) {
    parts.push("", "\uF15B Files Read:");
    for (const f of summary.files_read) {
      parts.push(`  \u2022 ${f}`);
    }
  }

  if (summary.files_modified.length > 0) {
    parts.push("", "\uF15C Files Modified:");
    for (const f of summary.files_modified) {
      parts.push(`  \u2022 ${f}`);
    }
  }

  if (summary.decisions.length > 0) {
    parts.push("", "\uF0E7 Decisions Made:");
    for (const d of summary.decisions) {
      parts.push(`  \u2022 ${d.text}`);
    }
  }

  if (summary.next_steps.length > 0) {
    const latest = summary.next_steps[summary.next_steps.length - 1];
    parts.push("", "\uF140 Next Steps:");
    parts.push(`  \u2022 ${latest.text}`);
    if (summary.next_steps.length > 1) {
      parts.push(
        `  (${summary.next_steps.length - 1} prior step groups archived)`,
      );
    }
  }

  if (summary.narrative_parts.length > 0) {
    parts.push("", "\uF0EA Summary:");
    for (const np of summary.narrative_parts) {
      parts.push("");
      parts.push(`From b${np.block_id}:`);
      parts.push(np.text);
    }
  }

  return parts.join("\n");
}

export function extractStructuredFields(
  params: Record<string, unknown>,
  config: DCPConfig,
): { fields: StructuredSummaryFields; narrative: string } {
  const fields: StructuredSummaryFields = {
    files_read: parseCSV(params.files_read as string | undefined),
    files_modified: parseCSV(params.files_modified as string | undefined),
    decisions: parseCSV(params.decisions as string | undefined),
    next_steps: parseCSV(params.next_steps as string | undefined),
  };

  const narrative = (params.summary as string) ?? "";

  if (config.structuredSummary.autoExtractPaths) {
    if (fields.files_read.length === 0 && fields.files_modified.length === 0) {
      const filePattern =
        /(?:\b(?:src|lib|app|test|config|public)\/[^\s,)]+(?:\.[a-z]+)?\b)|(?:\b[a-zA-Z0-9_-]+\/[a-zA-Z0-9._/-]+\.[a-z]+\b)/g;
      const matches = narrative.match(filePattern);
      if (matches) {
        const readContext = /read|open|look|check|examine|review/i;
        const modContext =
          /modify|edit|write|change|update|fix|add|create|delete|refactor/i;
        for (const m of new Set(matches)) {
          const idx = narrative.indexOf(m);
          const start = Math.max(0, idx - 60);
          const lineContext = narrative.substring(start, idx + m.length + 60);
          if (modContext.test(lineContext)) {
            if (!fields.files_modified.includes(m))
              fields.files_modified.push(m);
          } else if (readContext.test(lineContext)) {
            if (!fields.files_read.includes(m)) fields.files_read.push(m);
          } else {
            if (!fields.files_read.includes(m)) fields.files_read.push(m);
          }
        }
      }
    }
  }

  return { fields, narrative };
}
